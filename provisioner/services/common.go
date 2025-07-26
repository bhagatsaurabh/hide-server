package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

func UpdateWorkspaceStatus(workspaceUUID string, status string) error {
	wsJson, err := json.Marshal(&UpdateStatusRequest{
		Uuid:   workspaceUUID,
		Status: status,
	})
	if err != nil {
		return errors.New("Failed to marshal workspace status update request")
	}

	var wsReq *http.Request
	wsReq, err = http.NewRequest("PATCH", "http://workspace/api/update-status", bytes.NewBuffer(wsJson))
	if err != nil {
		return errors.New("Failed to update workspace status")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		return errors.New("Workspace status update request failed")
	}
	defer resp.Body.Close()
	return nil
}
