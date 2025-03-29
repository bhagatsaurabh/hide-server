package provisionsvc

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"hideserver/provisioner/util"
	"log"
	"time"

	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProvisionRequest struct {
	Image string `json:"image"`
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
