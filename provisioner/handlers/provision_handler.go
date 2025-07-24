package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

type WaitResponse struct {
	Wait bool `json:"wait"`
}

func ProvisionHandler(w http.ResponseWriter, r *http.Request, redisClient *redis.Client) {
	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var req services.ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		return
	}
	if req.Image == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing field: image")
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing x-auth-user header")
		return
	}
	decodedBytes, err := base64.StdEncoding.DecodeString(userHeader)
	if err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid Base64 encoding in x-auth-user header")
		return
	}
	var user UserHeader
	err = json.Unmarshal(decodedBytes, &user)
	if err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid JSON in x-auth-user header")
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	if req.Uuid != "" {
		err := CheckWorkspaceMembership(userHeader, req.Uuid)
		if err != nil {
			util.SendAPIErr(w, http.StatusForbidden, "Not a member of the workspace")
			return
		}
		var devContExists bool
		if devContExists, err = services.DevContainerExists(req.Uuid, devEnv); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "Could not check container existence")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if devContExists {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(WaitResponse{Wait: false})
		} else {
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(WaitResponse{Wait: true})
			go provision(req, userHeader, false, devEnv, redisClient)
		}
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(WaitResponse{Wait: true})
	go provision(req, userHeader, true, devEnv, redisClient)
}

func provision(req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client) {
	privateKey, workspaceUUID, err := services.CreateDevContainer(req, isNew, devEnv, redisClient)
	if err != nil {
		message := "Failed to provision workspace"
		if !isNew {
			message = "Failed to restore workspace"
		}
		log.Println(err.Error())
		msg, _ := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: message},
				}},
		})
		redisClient.Publish(context.Background(), "socket.send", msg)
		return
	}

	if isNew {
		var workspace services.WorkspaceDTO
		err = services.CreateWorkspace(req, userHeader, workspaceUUID, &workspace)

		msg, _ := json.Marshal(services.ServiceEvent[services.ProvisionDTO]{
			Payload: services.ServiceEventPayload[services.ProvisionDTO]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.ProvisionDTO]{
					Action: "success", Payload: services.ProvisionDTO{
						Message:    "Pod created successfully",
						PrivateKey: privateKey,
						Workspace:  workspace,
					},
				}},
		})
		redisClient.Publish(context.Background(), "socket.send", msg)
	} else {
		msg, _ := json.Marshal(services.ServiceEvent[services.ReadyPayload]{
			Payload: services.ServiceEventPayload[services.ReadyPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.ReadyPayload]{
					Action: "ready", Payload: services.ReadyPayload{
						Message: "Ready",
					},
				}},
		})
		redisClient.Publish(context.Background(), "socket.send", msg)
	}
}
func CheckWorkspaceMembership(userHeader string, workspaceUUID string) error {
	var wsReq *http.Request
	wsReq, err := http.NewRequest("GET", fmt.Sprintf("http://workspace/api/%s/check-membership", workspaceUUID), nil)
	if err != nil {
		return errors.New("Failed to create request")
	}
	wsReq.Header.Set("Content-Type", "application/json")
	wsReq.Header.Set("x-auth-user", userHeader)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(wsReq)
	if err != nil {
		return errors.New("Not a member of workspace")
	}
	defer resp.Body.Close()
	return nil
}
