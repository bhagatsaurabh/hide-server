package util

import (
	"context"
	"errors"
	"fmt"
	"time"

	v1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func GetPrepareVolumeJobSpec(wsUuid string, dataStorageQty string, configStorageQty string) *v1.Job {
	priviledged := true
	hostPathType := corev1.HostPathDirectoryOrCreate
	job := &v1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "prepare-workspace-volume",
			Namespace: "default",
		},
		Spec: v1.JobSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					NodeSelector: map[string]string{
						"workspace-storage": "local",
					},
					Containers: []corev1.Container{
						{
							Name:            "prepare-volume",
							Image:           "debian:bookworm-slim",
							SecurityContext: &corev1.SecurityContext{Privileged: &priviledged},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "host-volumes",
									MountPath: "/host-volumes",
								},
							},
							Env: []corev1.EnvVar{
								{Name: "DATA_VOLUME_NAME", Value: fmt.Sprintf("workspace-data-%s", wsUuid)},
								{Name: "DATA_VOLUME_SIZE", Value: "1G"},
								{Name: "CONFIG_VOLUME_NAME", Value: fmt.Sprintf("workspace-config-%s", wsUuid)},
								{Name: "CONFIG_VOLUME_SIZE", Value: "32M"},
							},
							Command: []string{"/bin/bash", "-c"},
							Args: []string{`
											apt-install -y lvm2
											set -eux

											DATA_MNT=/host-volumes/$DATA_VOLUME_NAME
											lvcreate -L $DATA_VOLUME_SIZE -n $DATA_VOLUME_NAME k8s-vg
											mkfs.ext4 /dev/k8s-vg/$DATA_VOLUME_NAME
											mkdir -p $DATA_MNT
											mount /dev/k8s-vg/$DATA_VOLUME_NAME $DATA_MNT

											CONFIG_MNT=/host-volumes/$CONFIG_VOLUME_NAME
											lvcreate -L $CONFIG_VOLUME_SIZE -n $CONFIG_VOLUME_NAME k8s-vg
											mkfs.ext4 /dev/k8s-vg/$CONFIG_VOLUME_NAME
											mkdir -p $CONFIG_MNT
											mount /dev/k8s-vg/$CONFIG_VOLUME_NAME $CONFIG_MNT
                    `},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "host-volumes",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/var/lib/k8s-volumes",
									Type: &hostPathType,
								},
							},
						},
					},
				},
			},
		},
	}
	return job
}

func WaitForJobCompletion(bgCtx context.Context, clientset *kubernetes.Clientset, jobName string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(bgCtx, timeout)
	defer cancel()

	watcher, err := clientset.BatchV1().Jobs("default").Watch(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("metadata.name=%s", jobName),
	})
	if err != nil {
		return errors.New("Failed to watch job")
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return errors.New("Job watch timed out")
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return errors.New("Watch channel closed unexpectedly")
			}
			job, ok := event.Object.(*v1.Job)
			if !ok {
				continue
			}

			if job.Status.Succeeded > 0 {
				return nil
			}
			if job.Status.Failed > 0 {
				return errors.New("Job failed")
			}
		}
	}
}
