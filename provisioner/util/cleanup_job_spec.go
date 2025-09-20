package util

import (
	v1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetCleanupJobSpec(dataVolumeName string, configVolumeName string) *v1.Job {
	priviledged := true
	job := &v1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cleanup-volume",
			Namespace: "default",
		},
		Spec: v1.JobSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers: []corev1.Container{
						{
							Name:            "cleaner",
							Image:           "debian:bookworm-slim",
							SecurityContext: &corev1.SecurityContext{Privileged: &priviledged},
							Env: []corev1.EnvVar{
								{Name: "DATA_VOLUME_NAME", Value: dataVolumeName},
								{Name: "CONFIG_VOLUME_NAME", Value: configVolumeName},
							},
							Command: []string{"/bin/bash", "-c"},
							Args: []string{`
								set -eux
								apt-get update && apt-get install -y lvm2
								lvremove -y /dev/k8s-vg/$DATA_VOLUME_NAME
								lvremove -y /dev/k8s-vg/$CONFIG_VOLUME_NAME
								`},
						},
					},
				},
			},
		},
	}
	return job
}
