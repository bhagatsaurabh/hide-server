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
	mountPropagation := corev1.MountPropagationBidirectional
	job := &v1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("prepare-volume-%s", wsUuid),
			Namespace: "default",
		},
		Spec: v1.JobSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					HostPID:       true,
					HostNetwork:   true,
					HostIPC:       true,
					RestartPolicy: corev1.RestartPolicyNever,
					NodeSelector: map[string]string{
						"workspace-storage": "local",
					},
					Containers: []corev1.Container{
						{
							Name:            "prepare-volume",
							Image:           "hideregistry.azurecr.io/hide-server-util-lvm:latest",
							SecurityContext: &corev1.SecurityContext{Privileged: &priviledged},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:             "host-volumes",
									MountPath:        "/host-volumes",
									MountPropagation: &mountPropagation,
								},
								{
									Name:      "dev",
									MountPath: "/dev",
								},
								{
									Name:      "run",
									MountPath: "/run",
								},
								{
									Name:      "etc",
									MountPath: "/etc",
								},
								{
									Name:      "sys",
									MountPath: "/sys",
								},
								{
									Name:      "proc",
									MountPath: "/proc",
								},
							},
							Env: []corev1.EnvVar{
								{Name: "WORKSPACE_UUID", Value: wsUuid},
								{Name: "DATA_VOLUME_SIZE", Value: "1G"},
								{Name: "CONFIG_VOLUME_SIZE", Value: "32M"},
							},
							Command: []string{"/bin/bash", "-c"},
							Args: []string{`
											set -eux

											WORKSPACE_DIR=/host-volumes/workspaces/$WORKSPACE_UUID

											rm -f /host-volumes/.delete-$WORKSPACE_UUID || true
											mkdir -p "$WORKSPACE_DIR/data" "$WORKSPACE_DIR/config"

											vgs workspace-vg || { echo "workspace-vg not found"; exit 1; }

											lvcreate -L $DATA_VOLUME_SIZE -n ${WORKSPACE_UUID}-data workspace-vg
											sleep 1
											lvchange -ay /dev/workspace-vg/${WORKSPACE_UUID}-data
											sleep 1
											mkfs.ext4 /dev/workspace-vg/${WORKSPACE_UUID}-data
											sleep 3

											lvcreate -L $CONFIG_VOLUME_SIZE -n ${WORKSPACE_UUID}-config workspace-vg
											sleep 1
											lvchange -ay /dev/workspace-vg/${WORKSPACE_UUID}-config
											sleep 1
											mkfs.ext4 /dev/workspace-vg/${WORKSPACE_UUID}-config
											sleep 3

											echo 'LVs created and formatted successfully'

											if ! mountpoint -q "$WORKSPACE_DIR/data"; then
												echo 'data: Mounting...'
    										mount /dev/workspace-vg/${WORKSPACE_UUID}-data "$WORKSPACE_DIR/data"
											fi
											if ! mountpoint -q "$WORKSPACE_DIR/data"; then
                    		echo "data: Not mounted !"
											else
												echo "data: Mounted successfully"
                  		fi

											if ! mountpoint -q "$WORKSPACE_DIR/config"; then
												echo 'config: Mounting...'
    										mount /dev/workspace-vg/${WORKSPACE_UUID}-config "$WORKSPACE_DIR/config"
											fi
											if ! mountpoint -q "$WORKSPACE_DIR/config"; then
                    		echo "config: Not mounted !"
                  		else
												echo "config: Mounted successfully"
                  		fi
                    `},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "host-volumes",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/data/workspace-volumes",
									Type: &hostPathType,
								},
							},
						},
						{
							Name: "dev",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/dev",
									Type: &hostPathType,
								},
							},
						},
						{
							Name: "run",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/run",
									Type: &hostPathType,
								},
							},
						},
						{
							Name: "etc",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/etc",
									Type: &hostPathType,
								},
							},
						},
						{
							Name: "sys",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/sys",
									Type: &hostPathType,
								},
							},
						},
						{
							Name: "proc",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/proc",
									Type: &hostPathType,
								},
							},
						},
					},
					ImagePullSecrets: []corev1.LocalObjectReference{
						{
							Name: "acr-secret",
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
