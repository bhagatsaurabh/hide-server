package util

import (
	"fmt"

	"github.com/docker/docker/api/types/container"
)

func GetContainerSpec(image string, publicKey string) *container.Config {
	containerSpec := &container.Config{
		Image: image,
		Env: []string{
			"NODE_ENV=development",
			"SERVICE_PORT=80",
			"RMQ_URL=amqp://rabbitmq:5672",
			"REDIS_HOST=redis",
			"REDIS_PORT=6379",
			fmt.Sprintf("SSH_PUBLIC_KEY=%s", publicKey),
		},
	}
	return containerSpec
}
