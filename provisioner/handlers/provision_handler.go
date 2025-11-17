package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type WaitResponse struct {
	Wait bool `json:"wait"`
}
type NestWrapper[T any] struct {
	Pattern string `json:"pattern"`
	Data    T      `json:"data"`
}
type RequestAffinityPayload struct {
	Uid       string `json:"uid"`
	SessionId string `json:"sessionId"`
	Uuid      string `json:"uuid"`
	ReqAction string `json:"reqAction"`
}
type IntServiceEvent[T any] struct {
	Payload T `json:"payload"`
}
type APIErrorResponse struct {
	StatusCode int64  `json:"statusCode"`
	Message    string `json:"message"`
}

func ProvisionHandler(sysCtx context.Context, w http.ResponseWriter, r *http.Request, redisClient *redis.Client, natsClient *nats.Conn) {
	log.Debug("Provision started")
	bgCtx, cancel := context.WithTimeout(sysCtx, 3*time.Minute)

	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "WORKSPACE_PROVISION_INVALID_REQUEST")
		cancel()
		return
	}
	var req services.ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_PROVISION_INVALID_REQUEST")
		cancel()
		return
	}
	log.Debugf("Req json %+v\n", req)
	if req.Uuid == "" {
		go services.SendStatus(context.Background(), redisClient, req.Uid, req.SessionId, "1/6:Validating request")
	}
	if req.Image == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_PROVISION_INVALID_REQUEST")
		cancel()
		return
	}
	templates, err := services.GetTemplates(redisClient)
	if err != nil {
		log.Errorf("Could not fetch templates: %v", err)
		util.SendAPIErr(w, http.StatusInternalServerError, "UNKNOWN")
		cancel()
		return
	}
	_, exists := templates[strings.TrimSuffix(req.Image, ":dev")]
	if !exists {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_PROVISION_INVALID_REQUEST")
		cancel()
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_PROVISION_INVALID_REQUEST")
		cancel()
		return
	}
	if req.Uuid == "" {
		if eligible, err := services.CheckEligibility(req, userHeader); err != nil {
			log.Debugf("Could not check eligibility: %v", err)
			util.SendAPIErr(w, http.StatusBadRequest, "UNKNOWN")
			cancel()
			return
		} else if !eligible {
			util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_PROVISION_QUOTA_REACHED")
			cancel()
			return
		}
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	if req.Uuid != "" {
		err := CheckWorkspaceMembership(userHeader, req.Uuid)
		if err != nil {
			util.SendAPIErr(w, http.StatusForbidden, "NO_WORKSPACE_MEMBERSHIP")
			cancel()
			return
		}
		var devContExists bool
		if devContExists, err = services.DevContainerExists(bgCtx, req.Uuid, devEnv); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "UNKNOWN")
			cancel()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if devContExists {
			log.Debugf("Uuid passed and container exists, sending no-wait")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(WaitResponse{Wait: false})
			cancel()
			return
		} else {
			log.Debugf("Uuid passed and container does not exist")
			go services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "Restoring your workspace")

			go func() {
				defer cancel()
				if err := provision(bgCtx, req, userHeader, false, devEnv, redisClient, natsClient); err != nil {
					log.Errorf("Restoring failed: %v", err)
				}
			}()
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(WaitResponse{Wait: true})
			return
		}
	}

	if req.Dedicated {
		log.Debugf("Dedicated workspace request, using access code")
		err = ConsumeAccessCode(req.AccessCode, userHeader)
		if err != nil {
			log.Debugf("Failed to consume access code")
			util.SendAPIErr(w, http.StatusBadRequest, "ACCESS_CODE_USE_FAILED")
			cancel()
			return
		}
	}

	go func() {
		defer cancel()
		if err := provision(bgCtx, req, userHeader, true, devEnv, redisClient, natsClient); err != nil {
			log.Errorf("Provisioning failed: %v", err)

			if req.Dedicated {
				if resetErr := ResetAccessCode(req.AccessCode, userHeader); resetErr != nil {
					log.Errorf("Failed to reset access code: %v", resetErr)
				}
			}
		} else {
			if req.Dedicated {
				if deleteErr := DeleteAccessCode(req.AccessCode, userHeader); deleteErr != nil {
					log.Errorf("Failed to delete access code post successful provisioning: %v", deleteErr)
				}
			}
		}
	}()
	log.Debugf("Sending wait")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(WaitResponse{Wait: true})
}

var queueLock sync.Mutex

func provision(bgCtx context.Context, req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client, natsClient *nats.Conn) error {
	queueLock.Lock()
	log.Debugf("Acquired queue lock")

	hasCpuCapacity, preemptPodName, err := hasCapacity(bgCtx, devEnv, req.Dedicated)
	if err != nil {
		log.Errorf("Could not check capacity: %v", err)
		go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, "UNKNOWN")
		queueLock.Unlock()
		return errors.New("UNKNOWN")
	}
	log.Debugf("HasCapacity: %t %s", hasCpuCapacity, preemptPodName)

	if !hasCpuCapacity && preemptPodName == "" {
		go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, "NO_CAPACITY")
		queueLock.Unlock()
		return errors.New("NO_CAPACITY")
	} else if preemptPodName != "" {
		log.Debugf("Preempting spot workspace: %s", preemptPodName)
		err = services.KillK8sPod(bgCtx, devEnv, preemptPodName)
		if err != nil {
			log.Errorf("Could not preempt spot workspace: %v", err)
			go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, "UNKNOWN")
			queueLock.Unlock()
			return errors.New("UNKNOWN")
		}
	}

	privateKey, workspaceUuid, err := services.CreateDevContainer(bgCtx, req, isNew, devEnv, redisClient)

	message := "WORKSPACE_PROVISION_FAILED"
	if !isNew {
		message = "WORKSPACE_RESTORE_FAILED"
	}
	if err != nil {
		go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, message)
		queueLock.Unlock()
		return err
	}

	if devEnv == "" {
		err = services.WaitOnDevContainerScheduled(bgCtx, workspaceUuid)
	}

	if err != nil {
		go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, message)
		queueLock.Unlock()
		return err
	}
	queueLock.Unlock()
	err = waitOnDevContainerReady(bgCtx, req, workspaceUuid, 90*time.Second, redisClient)

	if err != nil {
		go services.SendError(bgCtx, redisClient, req.Uid, req.SessionId, "WORKSPACE_BOOT_FAILED")
		return err
	}

	if isNew {
		log.Debugf("Writing workspace in database")
		var workspace services.WorkspaceDTO
		err = services.CreateWorkspace(req, userHeader, workspaceUuid, &workspace)
		services.SendSuccess(bgCtx, redisClient, req.Uid, req.SessionId, privateKey, workspace)
	} else {
		log.Debugf("Setting affinity")
		msg, cErr := json.Marshal(NestWrapper[IntServiceEvent[RequestAffinityPayload]]{
			Pattern: "env.internal",
			Data: IntServiceEvent[RequestAffinityPayload]{
				Payload: RequestAffinityPayload{
					ReqAction: "affinity", Uid: req.Uid, SessionId: req.SessionId, Uuid: req.Uuid,
				},
			},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		cErr = natsClient.Publish("env.internal", msg)
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
	}
	return err
}

func ConsumeAccessCode(code string, userHeader string) error {
	wsJson, err := json.Marshal(&services.ConsumeAccessCodeRequest{
		Code: code,
	})
	if err != nil {
		log.Errorf("Failed to marshal consume access code request, %v", err)
		return errors.New("UNKNOWN")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("POST", "http://workspace/api/access-consume", bytes.NewBuffer(wsJson))
	if err != nil {
		log.Errorf("Failed to create consume code request, %v", err)
		return errors.New("UNKNOWN")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		log.Errorf("Access code consumption request failed, %v", err)
		return errors.New("UNKNOWN")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 && resp.StatusCode > 299 {
		errResp, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Errorf("Failed to read error response, %v", err)
			return errors.New("UNKNOWN")
		}
		var errData APIErrorResponse
		err = json.Unmarshal(errResp, &errData)
		if err != nil {
			log.Errorf("Failed to unmarshal error response, %v", err)
			return errors.New("UNKNOWN")
		}
		return errors.New(errData.Message)
	} else {
		return nil
	}
}

func ResetAccessCode(code string, userHeader string) error {
	wsJson, err := json.Marshal(&services.ConsumeAccessCodeRequest{
		Code: code,
	})
	if err != nil {
		log.Printf("Error: Failed to marshal reset access code request, %v", err)
		return errors.New("UNKNOWN")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("POST", "http://workspace/api/access-reset", bytes.NewBuffer(wsJson))
	if err != nil {
		log.Printf("Error: Failed to create request, %v", err)
		return errors.New("UNKNOWN")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		log.Printf("Error: Access code reset request failed, %v", err)
		return errors.New("UNKNOWN")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 && resp.StatusCode > 299 {
		errResp, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error: Failed to read error response, %v", err)
			return errors.New("UNKNOWN")
		}
		var errData APIErrorResponse
		err = json.Unmarshal(errResp, &errData)
		if err != nil {
			log.Printf("Error: Failed to unmarshal error response, %v", err)
			return errors.New("UNKNOWN")
		}
		return errors.New(errData.Message)
	} else {
		return nil
	}
}

func DeleteAccessCode(code string, userHeader string) error {
	wsReq, err := http.NewRequest("DELETE", fmt.Sprintf("http://workspace/api/access-delete?code=%s", code), nil)
	if err != nil {
		log.Printf("Error: Failed to create request, %v", err)
		return errors.New("UNKNOWN")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		log.Printf("Error: Access code delete request failed, %v", err)
		return errors.New("UNKNOWN")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 && resp.StatusCode > 299 {
		errResp, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error: Failed to read error response, %v", err)
			return errors.New("UNKNOWN")
		}
		var errData APIErrorResponse
		err = json.Unmarshal(errResp, &errData)
		if err != nil {
			log.Printf("Error: Failed to unmarshal error response, %v", err)
			return errors.New("UNKNOWN")
		}
		return errors.New(errData.Message)
	} else {
		return nil
	}
}

func waitOnDevContainerReady(bgCtx context.Context, req services.ProvisionRequest, uuid string, timeout time.Duration, redisClient *redis.Client) error {
	go services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "5/6:Almost there... starting services")

	deadline := time.Now().Add(timeout)
	client := &http.Client{
		Timeout: 3 * time.Second,
	}

	for time.Now().Before(deadline) {
		resp, err := client.Get(fmt.Sprintf("http://workspace-%s/ready", uuid))
		if err == nil && resp.StatusCode == http.StatusOK {
			go services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "6/6:Workspace ready !")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return errors.New("Workspace timed-out during boot")
}

func hasCapacity(bgCtx context.Context, devEnv string, dedicated bool) (bool, string, error) {
	if devEnv == "docker" {
		return true, "", nil
	}

	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Errorf("Error creating Kubernetes client: %v", err)
		return false, "", err
	}

	nodes, err := clientset.CoreV1().Nodes().List(bgCtx, metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list nodes: %v", err)
		return false, "", err
	}

	node := nodes.Items[0]
	cpuQty := node.Status.Allocatable[v1.ResourceCPU]
	allocatableCpu := cpuQty.MilliValue()
	idleThresholdCpuStr := os.Getenv("IDLE_THRESHOLD_CPU")
	if idleThresholdCpuStr == "" {
		idleThresholdCpuStr = "350"
	}
	idleThresholdCpu, err := strconv.ParseInt(idleThresholdCpuStr, 10, 64)
	if err != nil {
		return false, "", err
	}
	totalAvailableCpu := allocatableCpu - idleThresholdCpu

	log.Debugf("allocatableCpu: %d, idleThresholdCpu: %d, totalAvailableCpu: %d", allocatableCpu, idleThresholdCpu, totalAvailableCpu)

	var totalRequestedCpu int64 = 0
	pods, err := clientset.CoreV1().Pods("default").List(bgCtx, metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list pods: %v", err)
		return false, "", err
	}
	for _, pod := range pods.Items {
		if pod.Status.Phase != v1.PodRunning {
			continue
		}

		for _, container := range pod.Spec.Containers {
			reqs := container.Resources.Requests
			if cpuQty, ok := reqs[v1.ResourceCPU]; ok {
				totalRequestedCpu += cpuQty.MilliValue()
			}
		}
	}
	wsCpuStr := os.Getenv("WORKSPACE_CPU_REQUEST")
	if wsCpuStr == "" {
		wsCpuStr = "350"
	}
	wsCpu, err := strconv.ParseInt(wsCpuStr, 10, 64)
	if err != nil {
		return false, "", errors.New("Bad config for workspace requested cpu")
	}
	totalRequestedCpu += wsCpu

	log.Debugf("totalRequestedCpu: %d, wsCpu: %d", totalRequestedCpu, wsCpu)

	if totalRequestedCpu < totalAvailableCpu {
		return true, "", nil
	}

	spotPods, err := clientset.CoreV1().Pods("default").List(
		bgCtx,
		metav1.ListOptions{LabelSelector: "wstype=spot"},
	)
	log.Debugf("Number of spot pods: %d", spotPods.Size())
	if err != nil {
		log.Errorf("Failed to list pods with label wstype=spot: %v", err)
		return false, "", err
	}
	var oldestPod *v1.Pod
	var oldestTime time.Time
	for _, pod := range spotPods.Items {
		if pod.Status.Phase != v1.PodRunning {
			continue
		}
		ct := pod.CreationTimestamp.Time
		log.Debugf("Listing Pod: %s, %s", pod.Name, ct.String())
		if oldestPod == nil || ct.Before(oldestTime) {
			log.Debugf("Found candidate: %s", pod.Name)
			oldestPod = &pod
			oldestTime = ct
		}
	}

	spotHoursStr := os.Getenv("PREEMPT_SPOT_OLDER_THAN_HOURS")
	if spotHoursStr == "" {
		spotHoursStr = "12"
	}
	spotHours, err := strconv.ParseInt(spotHoursStr, 10, 64)
	if err != nil {
		return false, "", err
	}

	if dedicated {
		if oldestPod == nil {
			return false, "", nil
		} else {
			log.Debugf("Dedicated request, returning oldest pod to preempt")
			return false, oldestPod.Name, nil
		}
	}

	if oldestPod == nil {
		log.Debugf("Oldest pod is nil")
		return false, "", nil
	}

	cutoff := time.Now().Add(-1 * time.Duration(spotHours) * time.Hour)
	if oldestTime.Before(cutoff) {
		return false, oldestPod.Name, nil
	} else {
		return false, "", nil
	}
}
