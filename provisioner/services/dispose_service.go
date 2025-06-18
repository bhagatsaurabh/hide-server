package services

import (
	"context"
	"fmt"
	"hideserver/provisioner/config"
	"log"
	"time"

	"github.com/docker/docker/api/types/container"
)

func DisposeDevContainer(uuid string, devEnv string) error {
	var err error = nil
	if devEnv == "docker" {
		err = DisposeDockerContainer(uuid)
	} else {
		err = DisposeK8sPod(uuid)
	}
	return err
}

func DisposeDockerContainer(uuid string) error {
	cli, err := config.LoadDockerConfig()

	if err != nil {
		log.Println("Error creating docker client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	opts := container.RemoveOptions{
		Force:         true,
		RemoveVolumes: false,
	}

	if err := cli.ContainerRemove(ctx, fmt.Sprintf("workspace-%s", uuid), opts); err != nil {
		return err
	}
	return nil
}

func DisposeK8sPod(uuid string) error {
	// TODO
	return nil
}
