package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"

	"github.com/redis/go-redis/v9"
)

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
		var devCont *services.DevContainerSummary
		if devCont, err = services.DevContainerExists(req.Uuid, devEnv); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "Could not check container existence")
			return
		}
		if devCont != nil {
			if devCont.Running {
				w.WriteHeader(http.StatusOK)
			} else {
				start(req, w, req.Uuid, devCont.Id, devEnv, redisClient)
			}
			return
		} else {
			w.WriteHeader(http.StatusOK)
			go provision(req, userHeader, false, devEnv, redisClient)
			return
		}
	}

	w.WriteHeader(http.StatusAccepted)
	go provision(req, userHeader, true, devEnv, redisClient)
}

func provision(req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client) {
	privateKey, workspaceUUID, err := services.CreateDevContainer(req, isNew, devEnv, redisClient)
	if err != nil {
		log.Println(err.Error())
		msg, _ := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: "Failed to provision workspace"},
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
	}
}
func start(req services.ProvisionRequest, w http.ResponseWriter, uuid string, id string, devEnv string, redisClient *redis.Client) {
	err := services.StartDevContainer(req, uuid, id, devEnv, redisClient)
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to boot workspace")
	}
}
