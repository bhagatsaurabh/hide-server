package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetPodSpec(wsUuid string, image string, publicKey string, devEnv string) *v1.Pod {
	envs := []v1.EnvVar{
		{
			Name:  "SERVICE_PORT",
			Value: "80",
		},
		{
			Name:  "REDIS_PORT",
			Value: "6379",
		},
	}

	if publicKey != "" {
		envs = append(envs, v1.EnvVar{
			Name:  "SSH_PUBLIC_KEY",
			Value: publicKey,
		})
	}

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

	hostPathType := v1.HostPathDirectoryOrCreate
	podSpec := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("workspace-%s", wsUuid),
		},
		Spec: v1.PodSpec{
			Containers: []v1.Container{
				{
					Name:            "dev",
					Image:           image,
					ImagePullPolicy: v1.PullNever, // revisit
					Env:             envs,
					VolumeMounts: []v1.VolumeMount{
						{
							MountPath: "/home/devuser/workspace",
							Name:      fmt.Sprintf("workspace-volume-%s", wsUuid),
						},
					},
				},
			},
			Volumes: []v1.Volume{
				{
					Name: fmt.Sprintf("workspace-volume-%s", wsUuid),
					VolumeSource: v1.VolumeSource{
						HostPath: &v1.HostPathVolumeSource{
							Path: fmt.Sprintf("/data/%s", wsUuid),
							Type: &hostPathType,
						},
					},
				},
			},
		},
	}

	return podSpec
}
