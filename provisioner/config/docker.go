package config

import (
	"os"

	"github.com/docker/docker/client"
)

func LoadDockerConfig() (*client.Client, error) {
	host, _ := os.LookupEnv("DOCKER_HOST")
	cli, err := client.NewClientWithOpts(
		client.WithHost(host),
		client.WithAPIVersionNegotiation(),
	)
	return cli, err
}
