package provisionsvc

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
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type UserHeader struct {
	Uid      string `json:"uid"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Picture  string `json:"picture"`
	Issuer   string `json:"issuer"`
}
type ProvisionRequest struct {
	Image       string `json:"image"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type CreateWorkspaceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Uuid        string `json:"uuid"`
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

// Development-only
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
					Source: fmt.Sprintf("%s\\%s", sourcePath, "env-gateway"),
					Target: "/app/env-gateway",
				},
				{
					Type:   mount.TypeVolume,
					Target: "/app/env-gateway/node_modules",
				},
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

	resp, err := cli.ContainerCreate(
		ctx,
		util.GetContainerSpec(req.Image, publicKey),
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

func CreateWorkspace(req ProvisionRequest, userHeader string, workspaceUUID string, workspace *WorkspaceDTO) error {
	wsJson, err := json.Marshal(&CreateWorkspaceRequest{
		Name:        req.Name,
		Description: req.Description,
		Uuid:        workspaceUUID,
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
