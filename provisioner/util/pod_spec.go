package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func GetPodSpec(wsUuid string, image string, publicKey string, wsType string) *v1.Pod {
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

	envs = append(envs, v1.EnvVar{
		Name:  "RMQ_URL",
		Value: "amqp://rabbitmq:5672",
	}, v1.EnvVar{
		Name:  "REDIS_HOST",
		Value: "redis",
	})

	podSpec := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("workspace-%s", wsUuid),
			Labels: map[string]string{
				"wstype": wsType,
			},
		},
		Spec: v1.PodSpec{
			RestartPolicy: v1.RestartPolicyAlways,
			Containers: []v1.Container{
				{
					Name:            "dev",
					Image:           fmt.Sprintf("hideregistry.azurecr.io/%s:latest", image),
					ImagePullPolicy: v1.PullAlways,
					Ports: []v1.ContainerPort{
						{ContainerPort: 22},
						{ContainerPort: 80},
					},
					Env: envs,
					VolumeMounts: []v1.VolumeMount{
						{
							MountPath: "/workspace",
							Name:      fmt.Sprintf("workspace-data-%s", wsUuid),
						},
						{
							MountPath: "/config",
							Name:      fmt.Sprintf("workspace-config-%s", wsUuid),
						},
					},
					ReadinessProbe: &v1.Probe{
						ProbeHandler: v1.ProbeHandler{
							HTTPGet: &v1.HTTPGetAction{
								Path: "/ready",
								Port: intstr.FromInt32(80),
							},
						},
						InitialDelaySeconds: 5,
						PeriodSeconds:       5,
						TimeoutSeconds:      5,
						FailureThreshold:    3,
					},
					Resources: v1.ResourceRequirements{
						Requests: v1.ResourceList{
							v1.ResourceCPU:    resource.MustParse("300m"),
							v1.ResourceMemory: resource.MustParse("512Mi"),
						},
						Limits: v1.ResourceList{
							v1.ResourceCPU:    resource.MustParse("300m"),
							v1.ResourceMemory: resource.MustParse("512Mi"),
						},
					},
				},
			},
			Volumes: []v1.Volume{
				{
					Name: fmt.Sprintf("workspace-data-%s", wsUuid),
					VolumeSource: v1.VolumeSource{
						PersistentVolumeClaim: &v1.PersistentVolumeClaimVolumeSource{
							ClaimName: fmt.Sprintf("workspace-data-%s", wsUuid),
						},
					},
				},
				{
					Name: fmt.Sprintf("workspace-config-%s", wsUuid),
					VolumeSource: v1.VolumeSource{
						PersistentVolumeClaim: &v1.PersistentVolumeClaimVolumeSource{
							ClaimName: fmt.Sprintf("workspace-config-%s", wsUuid),
						},
					},
				},
			},
			ImagePullSecrets: []v1.LocalObjectReference{
				{
					Name: "acr-secret",
				},
			},
			InitContainers: []v1.Container{
				{
					Name:  "volume-check",
					Image: "busybox",
					VolumeMounts: []v1.VolumeMount{
						{
							Name:      fmt.Sprintf("workspace-data-%s", wsUuid),
							MountPath: "/workspace",
						},
					},
					Command: []string{
						"sh", "-c", "|",
						`
						echo "Waiting for /workspace to be mounted..."
						until mountpoint -q /workspace; do
							echo "Not mounted yet..."
							sleep 2
						done
						echo "/workspace is mounted!"
					  `},
				},
			},
		},
	}

	return podSpec
}
