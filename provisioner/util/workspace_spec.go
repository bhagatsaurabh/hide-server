package util

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func GetWorkspaceCRDSpec(wsUuid string, uid string) (schema.GroupVersionResource, *unstructured.Unstructured, error) {
	workspaceGVR := schema.GroupVersionResource{
		Group:    "workspace.hideserver",
		Version:  "v1alpha1",
		Resource: "workspaces",
	}

	dedicatedLeaseExpiryDaysStr := os.Getenv("DEDICATED_LEASE_EXPIRY_DAYS")
	if dedicatedLeaseExpiryDaysStr == "" {
		dedicatedLeaseExpiryDaysStr = "2"
	}
	dedicatedLeaseExpiryDays, err := strconv.ParseInt(dedicatedLeaseExpiryDaysStr, 10, 32)
	if err != nil {
		return workspaceGVR, nil, errors.New("Bad config for workspace requested cpu")
	}

	workspace := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "workspace.hideserver/v1alpha1",
			"kind":       "Workspace",
			"metadata": map[string]any{
				"name": fmt.Sprintf("workspace-%s", wsUuid),
			},
			"spec": map[string]any{
				"leaseExpiry": time.Now().Add(time.Duration(dedicatedLeaseExpiryDays) * 24 * time.Hour).Format(time.RFC3339),
				"podName":     fmt.Sprintf("workspace-%s", wsUuid),
				"uid":         uid,
			},
		},
	}

	return workspaceGVR, workspace, nil
}
