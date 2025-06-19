package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetPodSpec(workspaceUUID string, image string, publicKey string, devEnv string) *v1.Pod {
	// TODO
	envs := []v1.EnvVar{
		{
			Name:  "SSH_PUBLIC_KEY",
			Value: publicKey,
		},
		{
			Name:  "SERVICE_PORT",
			Value: "80",
		},
		{
			Name:  "REDIS_PORT",
			Value: "6379",
		},
	}

	// Development-only
	if devEnv == "k8s" {
		envs = append(envs, v1.EnvVar{
			Name:  "NODE_ENV",
			Value: "development",
		}, v1.EnvVar{
			Name:  "RMQ_URL",
			Value: "amqp://host.docker.internal:5672",
		}, v1.EnvVar{
			Name:  "REDIS_HOST",
			Value: "host.docker.internal",
		})
	} else {
		envs = append(envs, v1.EnvVar{
			Name:  "RMQ_URL",
			Value: "amqp://rabbitmq:5672",
		}, v1.EnvVar{
			Name:  "REDIS_HOST",
			Value: "redis",
		})
	}

	podSpec := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("workspace-%s", workspaceUUID),
		},
		Spec: v1.PodSpec{
			Containers: []v1.Container{
				{
					Name:            "dev",
					Image:           image,
					ImagePullPolicy: v1.PullNever,
					Env:             envs,
				},
			},
		},
	}

	return podSpec
}
