package util

import (
	"fmt"
	"os"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
)

func GetContainerSpec(workspaceUUID, image, publicKey string) *container.Config {
	envs := []string{
		"NODE_ENV=development",
		"SERVICE_PORT=80",
		"RMQ_URL=amqp://rabbitmq:5672",
		"REDIS_HOST=redis",
		"REDIS_PORT=6379",
		"EVENT_QUEUE_SIZE=100",
		fmt.Sprintf("WS_UUID=%s", workspaceUUID),
	}

	if publicKey != "" {
		envs = append(envs, fmt.Sprintf("SSH_PUBLIC_KEY=%s", publicKey))
	}
	containerSpec := &container.Config{
		Image: image,
		Env:   envs,
		Labels: map[string]string{
			"com.docker.compose.project": "hide-server",
			"com.docker.compose.service": fmt.Sprintf("workspace-%s", workspaceUUID),
		},
	}

	return containerSpec
}

func GetHostConfig(wsUuid string) *container.HostConfig {
	mounts := []mount.Mount{
		{
			Type:   mount.TypeVolume,
			Source: fmt.Sprintf("workspace-volume-%s", wsUuid),
			Target: "/workspace",
		},
		{
			Type:   mount.TypeVolume,
			Source: fmt.Sprintf("workspaceconfig-volume-%s", wsUuid),
			Target: "/devconfig",
		},
	}

	if sourcePath, exists := os.LookupEnv("DEV_FS_SOURCE"); exists {
		mounts = append(mounts,
			mount.Mount{
				Type:   mount.TypeBind,
				Source: fmt.Sprintf("%s\\%s", sourcePath, "filesystem"),
				Target: "/app/filesystem",
			},
			mount.Mount{
				Type:   mount.TypeVolume,
				Target: "/app/filesystem/.build",
			},
		)
	}

	return &container.HostConfig{
		Mounts: mounts,
	}
}
