package services

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"log"
	"strings"

	"github.com/docker/docker/api/types/container"
	k8sErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type UpdateStatusRequest struct {
	Uuid   string `json:"uuid"`
	Status string `json:"status"`
}

func DisposeDevContainer(bgCtx context.Context, uuid string, devEnv string) error {
	err := UpdateWorkspaceStatus(uuid, "DEPROVISIONING")
	if err != nil {
		return errors.New("Could not update workspace status")
	}

	switch devEnv {
	case "docker":
		err = DisposeDockerContainer(bgCtx, uuid)
	case "":
		err = DisposeK8sPod(bgCtx, uuid)
	default:
		err = errors.New("Unsupported dev env")
	}

	if err != nil {
		UpdateWorkspaceStatus(uuid, "ERROR")
	} else {
		UpdateWorkspaceStatus(uuid, "COLD")
	}
	return err
}

func DisposeDockerContainer(bgCtx context.Context, uuid string) error {
	cli, err := config.LoadDockerConfig()

	if err != nil {
		log.Println("Error creating client:", err)
		return err
	}

	containers, err := cli.ContainerList(bgCtx, container.ListOptions{
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
	if err := cli.ContainerRemove(bgCtx, fmt.Sprintf("workspace-%s", uuid), opts); err != nil {
		log.Println("Error removing docker container:", err)
		return err
	}
	return nil
}

func DisposeK8sPod(bgCtx context.Context, uuid string) error {
	config, err := config.LoadK8sConfig()

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	_, err = clientset.CoreV1().Pods("default").Get(bgCtx, fmt.Sprintf("workspace-%s", uuid), metav1.GetOptions{})
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
	err = clientset.CoreV1().Pods("default").Delete(bgCtx, fmt.Sprintf("workspace-%s", uuid), metav1.DeleteOptions{
		PropagationPolicy:  &deletePolicy,
		GracePeriodSeconds: &gracePeriod,
	})
	if err != nil {
		return err
	}
	err = clientset.CoreV1().Services("default").Delete(bgCtx, fmt.Sprintf("workspace-%s", uuid), metav1.DeleteOptions{})
	return err
}
