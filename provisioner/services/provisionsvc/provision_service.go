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
	"time"

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

func CreateK8sPod(req ProvisionRequest) (string, error) {
	config, err := config.LoadK8sConfig()

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return "", err
	}

	workspaceUUID := uuid.New().String()
	if workspaceUUID == "" {
		log.Println("Cannot generate UUID")
		return "", errors.New("Error creating Kubernetes client")
	}

	privateKey, publicKey, err := util.GenSSHKeyPair(4096)
	if err != nil {
		log.Println("Failed to generate SSH key pair")
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pod := util.GetPodSpec(workspaceUUID, req.Image, publicKey)
	_, err = clientset.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return "", err
	}

	service := util.GetServiceSpec(workspaceUUID)
	_, err = clientset.CoreV1().Services("default").Create(ctx, service, metav1.CreateOptions{})
	if err != nil {
		clientset.CoreV1().Pods("default").Delete(ctx, fmt.Sprintf("workspace-%s", workspaceUUID), metav1.DeleteOptions{})
		return "", err
	}

	return privateKey, err
}

func CreateWorkspace(req ProvisionRequest, userHeader string, workspace *WorkspaceDTO) error {
	wsJson, err := json.Marshal(&CreateWorkspaceRequest{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		return errors.New("Failed to marshal workspace request")
	}

	log.Printf("JSON output: %s", wsJson)
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
