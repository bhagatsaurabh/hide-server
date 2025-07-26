package services

import (
	"context"
	"errors"
	"fmt"
	"hideserver/provisioner/config"
	"log"
	"time"
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

	if devEnv == "docker" {
		err = DeleteDockerContainer(uuid)
	} else {
		err = DeleteK8sPod(uuid)
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

	err = cli.VolumeRemove(ctx, fmt.Sprintf("workspace-volume-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	err = cli.VolumeRemove(ctx, fmt.Sprintf("workspaceconfig-volume-%s", uuid), false)
	if err != nil {
		log.Println("Error removing volume: ", err)
	}
	return err
}

func DeleteK8sPod(uuid string) error {
	return DisposeK8sPod(uuid)
}
