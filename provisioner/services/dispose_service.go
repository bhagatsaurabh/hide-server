package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"log"
	"net/http"
	"time"

	"github.com/docker/docker/api/types/container"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type UpdateStatusRequest struct {
	Uuid   string `json:"uuid"`
	Status string `json:"status"`
}

func DisposeDevContainer(uuid string, devEnv string) error {
	err := UpdateWorkspaceStatus(uuid, "DEPROVISIONING")
	if err != nil {
		return errors.New("Could not update workspace status")
	}

	if devEnv == "docker" {
		err = DisposeDockerContainer(uuid)
	} else {
		err = DisposeK8sPod(uuid)
	}
	if err != nil {
		UpdateWorkspaceStatus(uuid, "ERROR")
	} else {
		UpdateWorkspaceStatus(uuid, "COLD")
	}
	return err
}

func DisposeDockerContainer(uuid string) error {
	cli, err := config.LoadDockerConfig()

	if err != nil {
		log.Println("Error creating docker client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	opts := container.RemoveOptions{
		Force:         true,
		RemoveVolumes: false,
	}

	if err := cli.ContainerRemove(ctx, fmt.Sprintf("workspace-%s", uuid), opts); err != nil {
		log.Println("Error removing docker container:", err)
		return err
	}
	return nil
}

func DisposeK8sPod(uuid string) error {
	config, err := config.LoadK8sConfig()

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deletePolicy := metav1.DeletePropagationForeground
	gracePeriod := int64(20)
	err = clientset.CoreV1().Pods("default").Delete(ctx, fmt.Sprintf("workspace-%s", uuid), metav1.DeleteOptions{
		PropagationPolicy:  &deletePolicy,
		GracePeriodSeconds: &gracePeriod,
	})
	if err != nil {
		return err
	}
	err = clientset.CoreV1().Services("default").Delete(ctx, fmt.Sprintf("workspace-service-%s", uuid), metav1.DeleteOptions{})
	return err
}

func UpdateWorkspaceStatus(workspaceUUID string, status string) error {
	wsJson, err := json.Marshal(&UpdateStatusRequest{
		Uuid:   workspaceUUID,
		Status: status,
	})
	if err != nil {
		return errors.New("Failed to marshal workspace status update request")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("PATCH", "http://workspace/api/update-status", bytes.NewBuffer(wsJson))
	if err != nil {
		return errors.New("Failed to update workspace status")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		return errors.New("Workspace status update request failed")
	}
	defer resp.Body.Close()
	return nil
}
