package services

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"hideserver/provisioner/util"
	"os"
	"time"

	log "github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func DeleteDevContainer(bgCtx context.Context, uuid string, devEnv string) error {
	err := UpdateWorkspaceStatus(uuid, "DELETING")
	if err != nil {
		return errors.New("Could not update workspace status")
	}

	err = DisposeDevContainer(bgCtx, uuid, devEnv)
	if err != nil {
		log.Println("Could not dispose container", err)
	}

	switch devEnv {
	case "docker":
		err = DeleteDockerContainer(bgCtx, uuid)
	case "":
		err = DeleteK8sPod(bgCtx, uuid)
	default:
		err = errors.New("Unsupported dev env")
	}

	if err != nil {
		log.Println("Could not delete container", err)
	}
	UpdateWorkspaceStatus(uuid, "DELETED")
	return nil
}

func DeleteDockerContainer(bgCtx context.Context, uuid string) error {
	cli, err := config.LoadDockerConfig()
	if err != nil {
		log.Println("Error creating client: ", err)
		return err
	}

	err = cli.VolumeRemove(bgCtx, fmt.Sprintf("workspace-data-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	err = cli.VolumeRemove(bgCtx, fmt.Sprintf("workspace-config-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	return err
}

func DeleteK8sPod(bgCtx context.Context, wsUuid string) error {
	config, err := config.LoadK8sConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	clientset.CoreV1().PersistentVolumeClaims("default").Delete(bgCtx, fmt.Sprintf("workspace-data-%s", wsUuid), metav1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumeClaims("default").Delete(bgCtx, fmt.Sprintf("workspace-config-%s", wsUuid), metav1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumes().Delete(bgCtx, fmt.Sprintf("workspace-data-%s", wsUuid), metav1.DeleteOptions{})
	clientset.CoreV1().PersistentVolumes().Delete(bgCtx, fmt.Sprintf("workspace-config-%s", wsUuid), metav1.DeleteOptions{})

	err = DisposeK8sPod(bgCtx, wsUuid)
	if err != nil {
		return err
	}

	job := util.GetCleanupJobSpec(wsUuid)
	_, err = clientset.BatchV1().Jobs("default").Create(bgCtx, job, metav1.CreateOptions{})
	if err != nil {
		return err
	}
	err = util.WaitForJobCompletion(bgCtx, clientset, job.Name, 1*time.Minute)
	if err != nil {
		log.Debugf("Cleanup job failed: %v", err)
	}
	if _, exists := os.LookupEnv("NO_JOB_DELETE"); !exists {
		propogationPolicy := metav1.DeletePropagationBackground
		err = clientset.BatchV1().Jobs("default").Delete(
			bgCtx, fmt.Sprintf("cleanup-volume-%s", wsUuid),
			metav1.DeleteOptions{PropagationPolicy: &propogationPolicy},
		)
		if err != nil {
			log.Debugf("Cleanup job deletion failed: %v", err)
		}
	}

	log.Debugf("Deleting workspace CRD")
	err = DeleteWorkspaceCRD(bgCtx, config, wsUuid)
	if err != nil {
		log.Debugf("Workspace CRD deletion failed: %v", err)
	}
	log.Debugf("Deleted workspace CRD")

	return err
}
