package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
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

type Template struct {
	Image string `json:"image"`
	Name  string `json:"name"`
}

func GetTemplates(redisClient *redis.Client) (map[string]struct{}, error) {
	val, err := redisClient.Get(context.Background(), "templates").Result()
	if err == redis.Nil {
		return nil, errors.New("No templates")
	} else if err != nil {
		return nil, errors.New("Failed to get templates from cache")
	}

	var templates []Template
	if err := json.Unmarshal([]byte(val), &templates); err != nil {
		return nil, errors.New("Failed to read templates")
	}

	imageSet := make(map[string]struct{})
	for _, c := range templates {
		imageSet[c.Image] = struct{}{}
	}

	return imageSet, nil
}
