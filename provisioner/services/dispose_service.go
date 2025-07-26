package services

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"log"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	k8sErrors "k8s.io/apimachinery/pkg/api/errors"
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
		log.Println("Error creating client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All: true,
	})
	if err != nil {
		log.Println("Error listing containers:", err)
		return err
	}
	var devCont *container.Summary = nil
outer:
	for _, cont := range containers {
		for _, name := range cont.Names {
			if strings.TrimPrefix(name, "/") == fmt.Sprintf("workspace-%s", uuid) {
				devCont = &cont
				break outer
			}
		}
	}
	if devCont == nil {
		return nil
	}

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

	_, err = clientset.CoreV1().Pods("default").Get(ctx, fmt.Sprintf("workspace-%s", uuid), metav1.GetOptions{})
	if err != nil {
		if k8sErrors.IsNotFound(err) {
			return nil
		} else {
			log.Println("Error retrieving pod")
			return err
		}
	}

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

