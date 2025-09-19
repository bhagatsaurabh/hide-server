package services

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"hideserver/provisioner/util"
	"log"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func DeleteDevContainer(uuid string, devEnv string) error {
	err := UpdateWorkspaceStatus(uuid, "DELETING")
	if err != nil {
		return errors.New("Could not update workspace status")
	}

	err = DisposeDevContainer(uuid, devEnv)
	if err != nil {
		log.Println("Could not dispose container", err)
	}

	switch devEnv {
	case "docker":
		err = DeleteDockerContainer(uuid)
	case "":
		err = DeleteK8sPod(uuid)
	default:
		err = errors.New("Unsupported dev env")
	}

	if err != nil {
		log.Println("Could not delete container", err)
	}
	UpdateWorkspaceStatus(uuid, "DELETED")
	return nil
}

func DeleteDockerContainer(uuid string) error {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		log.Println("Error creating client: ", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	err = cli.VolumeRemove(ctx, fmt.Sprintf("workspace-data-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	err = cli.VolumeRemove(ctx, fmt.Sprintf("workspace-config-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	return err
}

func DeleteK8sPod(wsUuid string) error {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clientset.CoreV1().PersistentVolumeClaims("default").Delete(ctx, fmt.Sprintf("workspace-data-%s", wsUuid), v1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumeClaims("default").Delete(ctx, fmt.Sprintf("workspace-config-%s", wsUuid), v1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumes().Delete(ctx, fmt.Sprintf("workspace-data-%s", wsUuid), v1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumes().Delete(ctx, fmt.Sprintf("workspace-config-%s", wsUuid), v1.DeleteOptions{})

	err = DisposeK8sPod(wsUuid)
	if err != nil {
		return err
	}

	job := util.GetCleanupJobSpec(fmt.Sprintf("workspace-data-%s", wsUuid), fmt.Sprintf("workspace-config-%s", wsUuid))
	_, err = clientset.BatchV1().Jobs("default").Create(context.TODO(), job, metav1.CreateOptions{})
	if err != nil {
		return err
	}
	return nil
}
