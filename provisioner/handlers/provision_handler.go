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
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

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
	bgCtx, cancel := context.WithTimeout(sysCtx, 3*time.Minute)

	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		cancel()
		return
	}
	var req services.ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		cancel()
		return
	}
	if req.Uuid == "" {
		services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "1/6:Validating request")
	}
	if req.Image == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing field: image")
		cancel()
		return
	}
	templates, err := services.GetTemplates(redisClient)
	if err != nil {
		log.Printf("Error: %v", err)
		util.SendAPIErr(w, http.StatusInternalServerError, "Unknown error")
		cancel()
		return
	}
	_, exists := templates[strings.TrimSuffix(req.Image, "-dev")]
	if !exists {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid field: image")
		cancel()
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing x-auth-user header")
		cancel()
		return
	}
	if req.Uuid == "" {
		if eligible, err := services.CheckEligibility(req, userHeader); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "UNKNOWN")
			cancel()
			return
		} else if !eligible {
			util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_CREATION_QUOTA_REACHED")
			cancel()
			return
		}
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	if req.Uuid != "" {
		err := CheckWorkspaceMembership(userHeader, req.Uuid)
		if err != nil {
			util.SendAPIErr(w, http.StatusForbidden, "Not a member of the workspace")
			cancel()
			return
		}
		var devContExists bool
		if devContExists, err = services.DevContainerExists(bgCtx, req.Uuid, devEnv); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "Could not check container existence")
			cancel()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if devContExists {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(WaitResponse{Wait: false})
		} else {
			services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "Restoring your workspace")

			go func() {
				defer cancel()
				if err := provision(bgCtx, req, userHeader, false, devEnv, redisClient, natsClient); err != nil {
					log.Printf("Provisioning failed: %v", err)
				}
			}()
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(WaitResponse{Wait: true})
		}
		cancel()
		return
	}

	if req.Dedicated {
		err = ConsumeAccessCode(req.AccessCode, userHeader)
		if err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, err.Error())
			cancel()
			return
		}
	}

	go func() {
		defer cancel()
		if err := provision(bgCtx, req, userHeader, true, devEnv, redisClient, natsClient); err != nil {
			log.Printf("Provisioning failed: %v", err)

			if req.Dedicated {
				if resetErr := ResetAccessCode(req.AccessCode, userHeader); resetErr != nil {
					log.Printf("Failed to reset access code: %v", resetErr)
				}
			}
		}
	}()
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(WaitResponse{Wait: true})
}

var queueLock sync.Mutex

func provision(bgCtx context.Context, req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client, natsClient *nats.Conn) error {
	// TODO: Lock + Capacity check + Create + Watch until Scheduled + Unlock

	queueLock.Lock()

	if !hasCapacity() {
		msg, cErr := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: "NO_CAPACITY"},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
		queueLock.Unlock()
		return errors.New("NO_CAPACITY")
	}

	privateKey, workspaceUuid, err := services.CreateDevContainer(bgCtx, req, isNew, devEnv, redisClient)
	if err != nil {
		message := "Failed to provision workspace"
		if !isNew {
			message = "Failed to restore workspace"
		}
		msg, cErr := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: message},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
		queueLock.Unlock()
		return err
	}
	err = waitOnDevContainerScheduled(bgCtx, workspaceUuid)
	if err != nil {
		message := "Failed to queue workspace"
		msg, cErr := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: message},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
		queueLock.Unlock()
		return err
	}
	queueLock.Unlock()
	err = waitOnDevContainerReady(bgCtx, req, workspaceUuid, 90*time.Second, redisClient)

	if err != nil {
		message := "Failed to start workspace"
		msg, cErr := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: message},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
		return err
	}

	if isNew {
		var workspace services.WorkspaceDTO
		err = services.CreateWorkspace(req, userHeader, workspaceUuid, &workspace)

		msg, cErr := json.Marshal(services.ServiceEvent[services.ProvisionDTO]{
			Payload: services.ServiceEventPayload[services.ProvisionDTO]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.ProvisionDTO]{
					Action: "success", Payload: services.ProvisionDTO{
						Message:    "Pod created successfully",
						PrivateKey: privateKey,
						Workspace:  workspace,
					},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
	} else {
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
		log.Printf("Error: Failed to marshal consume access code request, %v", err)
		return errors.New("UNKNOWN")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("POST", "http://workspace/api/access/consume", bytes.NewBuffer(wsJson))
	if err != nil {
		log.Printf("Error: Failed to create request, %v", err)
		return errors.New("UNKNOWN")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		log.Printf("Error: Access code consumption request failed, %v", err)
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

func ResetAccessCode(code string, userHeader string) error {
	wsJson, err := json.Marshal(&services.ConsumeAccessCodeRequest{
		Code: code,
	})
	if err != nil {
		log.Printf("Error: Failed to marshal reset access code request, %v", err)
		return errors.New("UNKNOWN")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("POST", "http://workspace/api/access/reset", bytes.NewBuffer(wsJson))
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

func waitOnDevContainerReady(bgCtx context.Context, req services.ProvisionRequest, uuid string, timeout time.Duration, redisClient *redis.Client) error {
	services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "5/6:Almost there... starting services")

	deadline := time.Now().Add(timeout)
	client := &http.Client{
		Timeout: 1 * time.Second,
	}

	for time.Now().Before(deadline) {
		resp, err := client.Get(fmt.Sprintf("http://workspace-%s/ready", uuid))
		if err == nil && resp.StatusCode == http.StatusOK {
			services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "6/6:Workspace ready !")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return errors.New("Workspace timed-out during boot")
}

func waitOnDevContainerScheduled(bgCtx context.Context, uuid string) error {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	watcher, err := clientset.CoreV1().Pods("default").Watch(bgCtx, metav1.ListOptions{FieldSelector: "metadata.name=" + fmt.Sprintf("workspace-%s", uuid)})
	if err != nil {
		log.Println("Failed to watch pod:", err)
		return err
	}
	defer watcher.Stop()

	for event := range watcher.ResultChan() {
		pod := event.Object.(*v1.Pod)
		if pod.Spec.NodeName != "" {
			return nil
		}
		if pod.Status.Phase == v1.PodFailed || pod.Status.Phase == v1.PodSucceeded {
			return fmt.Errorf("Pod ended before scheduling: %s", pod.Status.Phase)
		}
	}
	return fmt.Errorf("watch closed before scheduling")
}

func hasCapacity() bool {
	// TODO
	return true
}
