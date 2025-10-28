package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"hideserver/provisioner/util"
	"io"
	"net/http"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	v1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProvisionRequest struct {
	Uid         string `json:"uid"`
	SessionId   string `json:"sessionId"`
	Image       string `json:"image"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Uuid        string `json:"uuid,omitempty"`
	Dedicated   bool   `json:"dedicated,omitempty"`
	AccessCode  string `json:"accessCode,omitempty"`
}
type ProvisionDTO struct {
	PrivateKey string       `json:"privateKey"`
	Message    string       `json:"message"`
	Workspace  WorkspaceDTO `json:"workspace"`
}
type CreateWorkspaceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Uuid        string `json:"uuid"`
	Image       string `json:"image"`
}
type ConsumeAccessCodeRequest struct {
	Code string `json:"code"`
}
type MembershipDTO struct {
	WorkspaceId int64  `json:"workspaceId"`
	UserId      string `json:"userId"`
	Role        string `json:"role"`
	JoinedAt    string `json:"joinedAt"`
	Name        string `json:"name"`
	Username    string `json:"username"`
	Picture     string `json:"picture"`
}
type WorkspaceDTO struct {
	Id          int64           `json:"id"`
	Uuid        string          `json:"uuid"`
	Image       string          `json:"image"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	CreatedAt   string          `json:"createdAt"`
	Memberships []MembershipDTO `json:"memberships"`
	Status      string          `json:"status"`
}
type DevContainerSummary struct {
	Running bool
	Id      string
}
type ProvisionStatusDTO struct {
	Message string `json:"message"`
}
type StatusPayload struct {
	Message string `json:"message"`
}
type ReadyPayload struct {
	Message string `json:"message"`
}
type ErrorPayload struct {
	Message string `json:"message"`
}
type PayloadMessage[T any] struct {
	Action  string `json:"action"`
	Payload T      `json:"payload"`
}
type ServiceEventPayload[T any] struct {
	Uid       string            `json:"uid"`
	SessionId string            `json:"sessionId"`
	Pattern   string            `json:"pattern"`
	Msg       PayloadMessage[T] `json:"msg"`
}
type ServiceEvent[T any] struct {
	Payload ServiceEventPayload[T] `json:"payload"`
}

func CreateDevContainer(bgCtx context.Context, req ProvisionRequest, isNew bool, devEnv string, redisClient *redis.Client) (string, string, error) {
	log.Debugf("Creating container: isNew:%t dedicated:%t, code:%s", isNew, req.Dedicated, req.AccessCode)
	if !isNew {
		SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "1/6:Restoring your data")
		log.Debugf("Checking volume existence")
		volumeExists, err := VolumeExists(bgCtx, req.Uuid, devEnv)
		if err != nil {
			return "", "", err
		}
		if !volumeExists {
			return "", "", errors.New("Volume not found for existing workspace")
		}
	}

	var err error = nil
	var privateKey, workspaceUuid string
	switch devEnv {
	case "docker":
		privateKey, workspaceUuid, err = CreateDockerContainer(bgCtx, redisClient, req, isNew)
	case "":
		privateKey, workspaceUuid, err = CreateK8sPod(bgCtx, redisClient, req, isNew)
	default:
		return "", "", errors.New("Unsupported dev env")
	}

	if err != nil {
		return "", "", err
	}

	return privateKey, workspaceUuid, nil
}
func CreateK8sPod(bgCtx context.Context, redisClient *redis.Client, req ProvisionRequest, isNew bool) (string, string, error) {
	log.Debugf("Creating pod")
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return "", "", err
	}

	wsUuid := req.Uuid
	if isNew {
		wsUuid = uuid.New().String()
	}
	if wsUuid == "" {
		log.Errorf("No UUID specified")
		return "", "", errors.New("No UUID specified")
	}

	privateKey, publicKey, err := "", "", nil
	if isNew {
		privateKey, publicKey, err = util.GenSSHKeyPair(4096)
	}
	if err != nil {
		log.Errorf("Failed to generate SSH key pair")
		return "", "", err
	}

	if isNew {
		SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "2/6:Preparing storage")
		log.Debugf("Preparing volumes")
		err = PerpareK8sVolume(clientset, bgCtx, wsUuid)
		if err != nil {
			return "", "", err
		}

		err := clientset.BatchV1().Jobs("default").Delete(bgCtx, fmt.Sprintf("prepare-volume-%s", wsUuid), metav1.DeleteOptions{})
		if err != nil {
			log.Debugf("Job deletion failed: %v", err)
		}

		SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "3/6:Allocating storage")
		log.Debugf("Creating volumes")
		err = CreateK8sVolume(clientset, bgCtx, wsUuid)
	}
	if err != nil {
		return "", "", err
	}

	SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "4/6:Setting up your environment")
	wsType := "spot"
	if req.Dedicated {
		wsType = "dedicated"
	}
	pod := util.GetPodSpec(wsUuid, req.Image, publicKey, wsType)
	log.Debugf("Deploying pod")
	_, err = clientset.CoreV1().Pods("default").Create(bgCtx, pod, metav1.CreateOptions{})
	if err != nil {
		return "", "", err
	}
	service := util.GetServiceSpec(wsUuid)
	log.Debugf("Deploying service")
	_, err = clientset.CoreV1().Services("default").Create(bgCtx, service, metav1.CreateOptions{})
	if err != nil {
		gracePeriod := int64(0)
		clientset.CoreV1().Pods("default").Delete(bgCtx, fmt.Sprintf("workspace-%s", wsUuid), metav1.DeleteOptions{
			GracePeriodSeconds: &gracePeriod,
		})
		return "", "", err
	}

	return privateKey, wsUuid, err
}
func CreateDockerContainer(bgCtx context.Context, redisClient *redis.Client, req ProvisionRequest, isNew bool) (string, string, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		log.Println("Error creating docker client:", err)
		return "", "", err
	}

	wsUuid := req.Uuid
	if isNew {
		wsUuid = uuid.New().String()
	}
	if wsUuid == "" {
		log.Println("Cannot generate UUID")
		return "", "", errors.New("Cannot generate UUID")
	}

	privateKey, publicKey, err := "", "", nil
	if isNew {
		privateKey, publicKey, err = util.GenSSHKeyPair(4096)
	}
	if err != nil {
		log.Println("Failed to generate SSH key pair")
		return "", "", err
	}

	if isNew {
		SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "2/6:Preparing storage")

		err = CreateDockerVolume(cli, bgCtx, fmt.Sprintf("workspace-data-%s", wsUuid))
		if err != nil {
			return "", "", err
		}
		err = CreateDockerVolume(cli, bgCtx, fmt.Sprintf("workspace-config-%s", wsUuid))
	}
	if err != nil {
		return "", "", err
	}

	SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "3/6:Allocating storage")
	resp, err := cli.ContainerCreate(
		bgCtx,
		util.GetContainerSpec(wsUuid, req.Image, publicKey),
		util.GetHostConfig(wsUuid),
		&network.NetworkingConfig{
			EndpointsConfig: map[string]*network.EndpointSettings{
				"hide-server_hide-network": {},
			},
		}, nil, fmt.Sprintf("workspace-%s", wsUuid),
	)
	if err != nil {
		log.Println("Failed to create container", err)
		return "", "", err
	}

	SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "4/6:Setting up your environment")
	if err := cli.ContainerStart(bgCtx, resp.ID, container.StartOptions{}); err != nil {
		log.Println("Failed to start container", err)
		return "", "", err
	}

	return privateKey, wsUuid, err
}

func VolumeExists(bgCtx context.Context, uuid string, devEnv string) (bool, error) {
	switch devEnv {
	case "docker":
		return DockerVolumeExists(bgCtx, uuid)
	case "":
		return K8sVolumeExists(bgCtx, uuid)
	default:
		return false, errors.New("Unsupported dev env")
	}
}
func DockerVolumeExists(bgCtx context.Context, uuid string) (bool, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return false, err
	}
	defer cli.Close()

	_, err = cli.VolumeInspect(bgCtx, fmt.Sprintf("workspace-data-%s", uuid))
	if err != nil {
		if client.IsErrNotFound(err) {
			return false, nil
		}
		return false, err
	}

	return true, nil
}
func K8sVolumeExists(bgCtx context.Context, uuid string) (bool, error) {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return false, err
	}

	_, err = clientset.CoreV1().
		PersistentVolumes().
		Get(bgCtx, fmt.Sprintf("workspace-data-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	_, err = clientset.CoreV1().
		PersistentVolumeClaims("default").
		Get(bgCtx, fmt.Sprintf("workspace-data-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	_, err = clientset.CoreV1().
		PersistentVolumes().
		Get(bgCtx, fmt.Sprintf("workspace-config-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	_, err = clientset.CoreV1().
		PersistentVolumeClaims("default").
		Get(bgCtx, fmt.Sprintf("workspace-config-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}

	return true, nil
}

func DevContainerExists(bgCtx context.Context, wsUuid string, devEnv string) (bool, error) {
	log.Debugf("Checking container existence")
	containerName := fmt.Sprintf("workspace-%s", wsUuid)
	switch devEnv {
	case "docker":
		return DockerContainerExists(bgCtx, containerName)
	case "":
		return K8sPodExists(bgCtx, containerName)
	default:
		return false, errors.New("Unsupported dev env")
	}
}
func DockerContainerExists(bgCtx context.Context, containerName string) (bool, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return false, err
	}
	defer cli.Close()

	containers, err := cli.ContainerList(bgCtx, container.ListOptions{
		All: true,
	})
	if err != nil {
		return false, err
	}

	var devCont *container.Summary = nil
outer:
	for _, cont := range containers {
		for _, name := range cont.Names {
			if strings.TrimPrefix(name, "/") == containerName {
				devCont = &cont
				break outer
			}
		}
	}

	if devCont == nil {
		return false, nil
	}
	return true, nil
}
func K8sPodExists(bgCtx context.Context, containerName string) (bool, error) {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return false, err
	}

	pod, err := clientset.CoreV1().Pods("default").Get(bgCtx, containerName, metav1.GetOptions{})

	if err != nil {
		if k8serrors.IsNotFound(err) {
			log.Debugf("Pod does not exist")
			return false, nil
		}
		log.Debugf("Could not check pod existence: %v", err)
		return false, err
	}

	log.Debugf("Pod exists %s", pod.Name)
	return true, nil
}

func CreateDockerVolume(cli *client.Client, ctx context.Context, volumeName string) error {
	args := filters.NewArgs()
	args.Add("name", volumeName)

	volumes, err := cli.VolumeList(ctx, volume.ListOptions{Filters: args})
	if err != nil {
		return err
	}

	if len(volumes.Volumes) > 0 {
		return nil
	}

	_, err = cli.VolumeCreate(ctx, volume.CreateOptions{
		Name: volumeName,
	})
	if err != nil {
		return err
	}
	return nil
}
func PerpareK8sVolume(clientset *kubernetes.Clientset, bgCtx context.Context, wsUuid string) error {
	jobSpec := util.GetPrepareVolumeJobSpec(wsUuid, "1G", "32M")
	log.Debugf("Running volume preparation job")
	job, err := clientset.BatchV1().Jobs("default").Create(bgCtx, jobSpec, metav1.CreateOptions{})
	if err != nil {
		log.Debugf("Job creation failed: %v", err)
		return errors.New("Could not create job to prepare volumes")
	}

	log.Debugf("Waiting for volume preparation job to complete")
	err = util.WaitForJobCompletion(bgCtx, clientset, job.Name, 1*time.Minute)
	if err != nil {
		log.Printf("Prepare volume job failed %v\n", err)
	}

	return nil
}
func CreateK8sVolume(clientset *kubernetes.Clientset, bgCtx context.Context, wsUuid string) error {
	dataStorageQty := resource.MustParse("1Gi")
	configStorageQty := resource.MustParse("32Mi")
	dataVolumeName := fmt.Sprintf("workspace-data-%s", wsUuid)
	configVolumeName := fmt.Sprintf("workspace-config-%s", wsUuid)

	dataPVSpec := util.GetPersistentVolumeSpec(wsUuid, dataVolumeName, "data", dataStorageQty)
	_, err := clientset.CoreV1().PersistentVolumes().Create(bgCtx, dataPVSpec, metav1.CreateOptions{})
	if err != nil {
		log.Debugf("'data' PV creation failed: %v", err)
		return errors.New("Could not create 'data' PV")
	}
	configPVSpec := util.GetPersistentVolumeSpec(wsUuid, configVolumeName, "config", configStorageQty)
	_, err = clientset.CoreV1().PersistentVolumes().Create(bgCtx, configPVSpec, metav1.CreateOptions{})
	if err != nil {
		clientset.CoreV1().PersistentVolumes().Delete(bgCtx, dataPVSpec.Name, metav1.DeleteOptions{})
		return errors.New("Could not create 'config' PV, cleaning up")
	}

	dataPVCSpec := util.GetPersistentVolumeClaimSpec(dataVolumeName, dataStorageQty)
	_, err = clientset.CoreV1().PersistentVolumeClaims("default").Create(bgCtx, dataPVCSpec, metav1.CreateOptions{})
	if err != nil {
		log.Debugf("'data' PVC creation failed: %v", err)
		clientset.CoreV1().PersistentVolumes().Delete(bgCtx, dataVolumeName, metav1.DeleteOptions{})
		clientset.CoreV1().PersistentVolumes().Delete(bgCtx, configVolumeName, metav1.DeleteOptions{})
		return errors.New("Could not create 'data' PVC, cleaning up")
	}
	configPVCSpec := util.GetPersistentVolumeClaimSpec(configVolumeName, configStorageQty)
	_, err = clientset.CoreV1().PersistentVolumeClaims("default").Create(bgCtx, configPVCSpec, metav1.CreateOptions{})
	if err != nil {
		clientset.CoreV1().PersistentVolumes().Delete(bgCtx, dataVolumeName, metav1.DeleteOptions{})
		clientset.CoreV1().PersistentVolumes().Delete(bgCtx, configVolumeName, metav1.DeleteOptions{})
		clientset.CoreV1().PersistentVolumeClaims("default").Delete(bgCtx, dataVolumeName, metav1.DeleteOptions{})
		return errors.New("Could not create 'config' PVC, cleaning up")
	}
	return nil
}

func CreateWorkspace(req ProvisionRequest, userHeader string, workspaceUUID string, workspace *WorkspaceDTO) error {
	wsJson, err := json.Marshal(&CreateWorkspaceRequest{
		Name:        req.Name,
		Description: req.Description,
		Uuid:        workspaceUUID,
		Image:       req.Image,
	})
	if err != nil {
		return errors.New("Failed to marshal workspace request")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("POST", "http://workspace/api/create", bytes.NewBuffer(wsJson))
	if err != nil {
		return errors.New("Failed to create request")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		return errors.New("Workspace creation request failed")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return errors.New("Failed to read workspace creation response")
	}

	err = json.Unmarshal(body, &workspace)
	return err
}

func CheckEligibility(req ProvisionRequest, userHeader string) (bool, error) {
	var wsReq *http.Request
	wsReq, err := http.NewRequest("GET", "http://workspace/api/check-eligibility", nil)
	if err != nil {
		return false, errors.New("Failed to create request")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		return false, errors.New("Workspace creation eligibility check failed")
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200, nil
}

func WaitOnDevContainerScheduled(bgCtx context.Context, uuid string) error {
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

func KillK8sPod(bgCtx context.Context, devEnv string, podName string) error {
	if devEnv == "docker" {
		return nil
	}

	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	err = clientset.CoreV1().Pods("default").Delete(
		bgCtx,
		podName,
		metav1.DeleteOptions{
			GracePeriodSeconds: new(int64),
		},
	)
	return err
}
