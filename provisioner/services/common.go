package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
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

type TemplateDTO struct {
	Value   []Template `json:"value"`
	Expires int64      `json:"expires"`
}
type Template struct {
	Name  string `json:"name"`
	Image string `json:"image"`
}

func GetTemplates(redisClient *redis.Client) (map[string]struct{}, error) {
	val, err := redisClient.Get(context.Background(), "templates").Result()
	if err == redis.Nil {
		return nil, errors.New("No templates")
	} else if err != nil {
		return nil, errors.New("Failed to get templates from cache")
	}

	var response TemplateDTO
	if err := json.Unmarshal([]byte(val), &response); err != nil {
		log.Printf("Error: %v", err)
		return nil, errors.New("Failed to read templates")
	}

	imageSet := make(map[string]struct{})
	for _, c := range response.Value {
		imageSet[c.Image] = struct{}{}
	}

	return imageSet, nil
}

func SendStatus(bgCtx context.Context, redisClient *redis.Client, uid string, sessionId string, message string) {
	sMsg, cErr := json.Marshal(ServiceEvent[StatusPayload]{
		Payload: ServiceEventPayload[StatusPayload]{
			Uid: uid, SessionId: sessionId, Pattern: "provision", Msg: PayloadMessage[StatusPayload]{
				Action: "status", Payload: StatusPayload{Message: message},
			}},
	})
	if cErr != nil {
		log.Printf("Warn: %v", cErr)
	}
	redisClient.Publish(bgCtx, "socket.send", sMsg)
}
