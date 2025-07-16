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
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	v1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProvisionRequest struct {
	Image       string `json:"image"`
	Uid         string `json:"uid"`
	SessionId   string `json:"sessionId"`
	Uuid        string `json:"uuid,omitempty"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
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

func CreateDevContainer(req ProvisionRequest, isNew bool, devEnv string, redisClient *redis.Client) (string, string, error) {
	sMsg, _ := json.Marshal(ServiceEvent[StatusPayload]{
		Payload: ServiceEventPayload[StatusPayload]{
			Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: PayloadMessage[StatusPayload]{
				Action: "status", Payload: StatusPayload{Message: "Provisioning"},
			}},
	})
	redisClient.Publish(context.Background(), "socket.send", sMsg)

	var err error = nil
	if !isNew {
		volumeExists, err := VolumeExists(req.Uuid, devEnv)
		if err != nil {
			return "", "", err
		}
		if !volumeExists {
			return "", "", errors.New("Volume not found for existing workspace")
		}
	}

	var privateKey, workspaceUuid string
	if devEnv == "docker" {
		privateKey, workspaceUuid, err = CreateDockerContainer(req, isNew)
	} else {
		privateKey, workspaceUuid, err = CreateK8sPod(req, isNew, devEnv)
	}

	err = waitOnDevContainerReady(req, workspaceUuid, 60*time.Second, redisClient)
	if err != nil {
		return "", "", err
	}

	return privateKey, workspaceUuid, nil
}
func CreateK8sPod(req ProvisionRequest, isNew bool, devEnv string) (string, string, error) {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

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
		err = CreateK8sVolume(clientset, ctx, wsUuid)
	}
	if err != nil {
		return "", "", err
	}

	pod := util.GetPodSpec(wsUuid, req.Image, publicKey, devEnv)
	_, err = clientset.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return "", "", err
	}
	service := util.GetServiceSpec(wsUuid)
	_, err = clientset.CoreV1().Services("default").Create(ctx, service, metav1.CreateOptions{})
	if err != nil {
		gracePeriod := int64(0)
		clientset.CoreV1().Pods("default").Delete(ctx, fmt.Sprintf("workspace-%s", wsUuid), metav1.DeleteOptions{
			GracePeriodSeconds: &gracePeriod,
		})
		return "", "", err
	}

	return privateKey, wsUuid, err
}
func CreateDockerContainer(req ProvisionRequest, isNew bool) (string, string, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		log.Println("Error creating docker client:", err)
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

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
		err = CreateDockerVolume(cli, ctx, fmt.Sprintf("workspace-volume-%s", wsUuid))
		if err != nil {
			return "", "", err
		}
		err = CreateDockerVolume(cli, ctx, fmt.Sprintf("workspaceconfig-volume-%s", wsUuid))
	}
	if err != nil {
		return "", "", err
	}

	resp, err := cli.ContainerCreate(
		ctx,
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
	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		log.Println("Failed to start container", err)
		return "", "", err
	}

	return privateKey, wsUuid, err
}

func VolumeExists(uuid string, devEnv string) (bool, error) {
	if devEnv == "docker" {
		return DockerVolumeExists(uuid)
	} else {
		return K8sVolumeExists(uuid)
	}
}
func DockerVolumeExists(uuid string) (bool, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return false, err
	}
	defer cli.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	_, err = cli.VolumeInspect(ctx, fmt.Sprintf("workspace-volume-%s", uuid))
	if err != nil {
		if client.IsErrNotFound(err) {
			return false, nil
		}
		return false, err
	}

	return true, nil
}
func K8sVolumeExists(uuid string) (bool, error) {
	// cost
	/* config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return false, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = clientset.CoreV1().
		PersistentVolumeClaims("default").
		Get(ctx, fmt.Sprintf("workspace-pvc-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}

	_, err = clientset.CoreV1().
		PersistentVolumes().
		Get(ctx, fmt.Sprintf("workspace-volume-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	} */
	return true, nil
}

func DevContainerExists(wsUuid string, devEnv string) (*DevContainerSummary, error) {
	containerName := fmt.Sprintf("workspace-%s", wsUuid)
	if devEnv == "docker" {
		return DockerContainerExists(containerName)
	} else {
		return K8sPodExists(containerName)
	}
}
func DockerContainerExists(containerName string) (*DevContainerSummary, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All: true,
	})
	if err != nil {
		return nil, err
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
		return nil, nil
	}
	return &DevContainerSummary{
		Running: devCont.State == "running",
		Id:      devCont.ID,
	}, nil
}
func K8sPodExists(containerName string) (*DevContainerSummary, error) {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pod, err := clientset.CoreV1().Pods("default").Get(ctx, containerName, metav1.GetOptions{})

	if err != nil {
		if k8serrors.IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}

	return &DevContainerSummary{
		Running: pod.Status.Phase == v1.PodRunning,
		Id:      "",
	}, nil
}

func StartDevContainer(req ProvisionRequest, uuid string, id string, devEnv string, redisClient *redis.Client) error {
	var err error = nil
	if devEnv == "docker" {
		err = StartDockerContainer(id)
	} else {
		err = StartK8sPod(id)
	}

	err = waitOnDevContainerReady(req, uuid, 60*time.Second, redisClient)
	return err
}
func StartDockerContainer(id string) error {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return err
	}
	defer cli.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := cli.ContainerStart(ctx, id, container.StartOptions{}); err != nil {
		return err
	}
	return nil
}
func StartK8sPod(id string) error {
	return errors.New("Workspace provisioned but not running")
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

func waitOnDevContainerReady(req ProvisionRequest, uuid string, timeout time.Duration, redisClient *redis.Client) error {
	sMsg, _ := json.Marshal(ServiceEvent[StatusPayload]{
		Payload: ServiceEventPayload[StatusPayload]{
			Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: PayloadMessage[StatusPayload]{
				Action: "status", Payload: StatusPayload{Message: "Booting up"},
			}},
	})
	redisClient.Publish(context.Background(), "socket.send", sMsg)

	deadline := time.Now().Add(timeout)
	client := &http.Client{
		Timeout: 1 * time.Second,
	}

	for time.Now().Before(deadline) {
		resp, err := client.Get(fmt.Sprintf("http://workspace-%s/ready", uuid))
		if err == nil && resp.StatusCode == http.StatusOK {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return errors.New("Workspace timed-out during boot")
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
func CreateK8sVolume(clientset *kubernetes.Clientset, ctx context.Context, volumeName string) error {
	// cost 😬
	return nil
}
