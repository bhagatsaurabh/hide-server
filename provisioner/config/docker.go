package config

import (
	"os"

	"github.com/docker/docker/client"
)

var cli *client.Client
var err error = nil
var isLoaded = false

func LoadDockerConfig() (*client.Client, error) {
	if isLoaded {
		return cli, err
	}

	host, _ := os.LookupEnv("DOCKER_HOST")
	cli, err = client.NewClientWithOpts(
		client.WithHost(host),
		client.WithAPIVersionNegotiation(),
	)
	if err == nil {
		isLoaded = true
	}
	return cli, err
}
