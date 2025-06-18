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
	"os"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProvisionRequest struct {
	Image       string `json:"image"`
	Uuid        string `json:"uuid,omitempty"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}
type CreateWorkspaceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Uuid        string `json:"uuid"`
	Image       string `json:"image"`
}
type MembershipDTO struct {
	WorkspaceId string `json:"workspaceId"`
	UserId      string `json:"userId"`
	Role        string `json:"role"`
	JoinedAt    string `json:"joinedAt"`
	Name        string `json:"name"`
	Username    string `json:"username"`
	Picture     string `json:"picture"`
}
type WorkspaceDTO struct {
	Id          int32           `json:"id"`
	Uuid        string          `json:"uuid"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	CreatedAt   string          `json:"createdAt"`
	Memberships []MembershipDTO `json:"memberships"`
}
type DevContainerSummary struct {
	Running bool
	Id      string
}

func CreateDevContainer(req ProvisionRequest, devEnv string) (string, string, error) {
	var privateKey, workspaceUuid string
	var err error
	if devEnv == "docker" {
		privateKey, workspaceUuid, err = CreateDockerContainer(req)
	} else {
		privateKey, workspaceUuid, err = CreateK8sPod(req, devEnv)
	}

	err = waitOnDevContainerReady(workspaceUuid, 10*time.Second)
	if err != nil {
		return "", "", err
	}

	return privateKey, workspaceUuid, nil
}
func CreateK8sPod(req ProvisionRequest, devEnv string) (string, string, error) {
	config, err := config.LoadK8sConfig()

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return "", "", err
	}

	workspaceUUID := uuid.New().String()
	if workspaceUUID == "" {
		log.Println("Cannot generate UUID")
		return "", "", errors.New("Error creating Kubernetes client")
	}

	privateKey, publicKey, err := util.GenSSHKeyPair(4096)
	if err != nil {
		log.Println("Failed to generate SSH key pair")
		return "", "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pod := util.GetPodSpec(workspaceUUID, req.Image, publicKey, devEnv)
	_, err = clientset.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return "", "", err
	}

	service := util.GetServiceSpec(workspaceUUID)
	_, err = clientset.CoreV1().Services("default").Create(ctx, service, metav1.CreateOptions{})
	if err != nil {
		clientset.CoreV1().Pods("default").Delete(ctx, fmt.Sprintf("workspace-%s", workspaceUUID), metav1.DeleteOptions{})
		return "", "", err
	}

	return privateKey, workspaceUUID, err
}
func CreateDockerContainer(req ProvisionRequest) (string, string, error) {
	cli, err := config.LoadDockerConfig()

	if err != nil {
		log.Println("Error creating docker client:", err)
		return "", "", err
	}

	workspaceUUID := uuid.New().String()
	if workspaceUUID == "" {
		log.Println("Cannot generate UUID")
		return "", "", errors.New("Cannot generate UUID")
	}

	privateKey, publicKey, err := util.GenSSHKeyPair(4096)
	if err != nil {
		log.Println("Failed to generate SSH key pair")
		return "", "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var hostConfig *container.HostConfig = nil
	if sourcePath, exists := os.LookupEnv("DEV_FS_SOURCE"); exists {
		log.Println(strings.ReplaceAll(sourcePath, `\`, `\`))
		hostConfig = &container.HostConfig{
			Mounts: []mount.Mount{
				{
					Type:   mount.TypeBind,
					Source: fmt.Sprintf("%s\\%s", sourcePath, "filesystem"),
					Target: "/app/filesystem",
				},
				{
					Type:   mount.TypeVolume,
					Target: "/app/filesystem/.build",
				},
			},
		}
	}

	err = CreateDockerVolume(cli, ctx, workspaceUUID)
	if err != nil {
		return "", "", err
	}

	resp, err := cli.ContainerCreate(
		ctx,
		util.GetContainerSpec(workspaceUUID, req.Image, publicKey),
		hostConfig,
		&network.NetworkingConfig{
			EndpointsConfig: map[string]*network.EndpointSettings{
				"hide-server_hide-network": {},
			},
		}, nil, fmt.Sprintf("workspace-%s", workspaceUUID),
	)
	if err != nil {
		log.Println("Failed to create container", err)
		return "", "", err
	}
	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		log.Println("Failed to start container", err)
		return "", "", err
	}

	return privateKey, workspaceUUID, err
}

func CreateDockerVolume(cli *client.Client, ctx context.Context, workspaceUuid string) error {
	volumeName := fmt.Sprintf("workspace-volume-%s", workspaceUuid)
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

func DevContainerExists(containerName string, devEnv string) (*DevContainerSummary, error) {
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

	return &DevContainerSummary{
		Running: devCont.State == "running",
		Id:      devCont.ID,
	}, nil
}
func K8sPodExists(containerName string) (*DevContainerSummary, error) {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	// TODO

	return &DevContainerSummary{
		Running: false,
		Id:      "",
	}, nil
}

func StartDevContainer(uuid string, id string, devEnv string) error {
	var err error = nil
	if devEnv == "docker" {
		err = StartDockerContainer(id)
	} else {
		err = StartK8sPod(id)
	}

	err = waitOnDevContainerReady(uuid, 10*time.Second)
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
	cli, err := config.LoadDockerConfig()
	if err != nil {
		return err
	}
	defer cli.Close()

	// TODO

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

func waitOnDevContainerReady(uuid string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{
		Timeout: 1 * time.Second,
	}

	for time.Now().Before(deadline) {
		resp, err := client.Get(fmt.Sprintf("http://workspace-%s", uuid))
		if err == nil && resp.StatusCode == http.StatusOK {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return errors.New("Workspace timed-out during boot")
}
