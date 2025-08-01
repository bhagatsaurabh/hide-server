package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
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
			RestartPolicy: v1.RestartPolicyAlways,
			Containers: []v1.Container{
				{
					Name:            "dev",
					Image:           image,
					ImagePullPolicy: v1.PullNever, // revisit
					Env:             envs,
					VolumeMounts: []v1.VolumeMount{
						{
							MountPath: "/workspace",
							Name:      fmt.Sprintf("workspace-volume-%s", wsUuid),
						},
						{
							MountPath: "/devconfig",
							Name:      fmt.Sprintf("workspaceconfig-volume-%s", wsUuid),
						},
					},
					Resources: v1.ResourceRequirements{
						Requests: v1.ResourceList{
							v1.ResourceCPU:    resource.MustParse("100m"),
							v1.ResourceMemory: resource.MustParse("256Mi"),
						},
						Limits: v1.ResourceList{
							v1.ResourceCPU:    resource.MustParse("100m"),
							v1.ResourceMemory: resource.MustParse("256Mi"),
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
				{
					Name: fmt.Sprintf("workspaceconfig-volume-%s", wsUuid),
					VolumeSource: v1.VolumeSource{
						HostPath: &v1.HostPathVolumeSource{
							Path: fmt.Sprintf("/data/devconfig/%s", wsUuid),
							Type: &hostPathType,
						},
					},
				},
			},
		},
	}

	return podSpec
}
