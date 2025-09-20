package handlers

import (
	"context"
	"encoding/json"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

type WaitResponse struct {
	Wait bool `json:"wait"`
}
type NestWrapper[T any] struct {
	Pattern string `json:"pattern"`
	Data    T      `json:"data"`
}
type RequestAffinityPayload struct {
	Uid       string `json:"uid"`
	SessionId string `json:"sessionId"`
	Uuid      string `json:"uuid"`
	ReqAction string `json:"reqAction"`
}
type IntServiceEvent[T any] struct {
	Payload T `json:"payload"`
}

func ProvisionHandler(w http.ResponseWriter, r *http.Request, redisClient *redis.Client, natsClient *nats.Conn) {
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
	templates, err := services.GetTemplates(redisClient)
	if err != nil {
		util.SendAPIErr(w, http.StatusInternalServerError, "Unknown error")
		return
	}
	_, exists := templates[req.Image]
	if !exists {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid field: image")
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing x-auth-user header")
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
			go provision(req, userHeader, false, devEnv, redisClient, natsClient)
		}
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(WaitResponse{Wait: true})
	go provision(req, userHeader, true, devEnv, redisClient, natsClient)
}

func provision(req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client, natsClient *nats.Conn) {
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
		msg, err := json.Marshal(NestWrapper[IntServiceEvent[RequestAffinityPayload]]{
			Pattern: "env.internal",
			Data: IntServiceEvent[RequestAffinityPayload]{
				Payload: RequestAffinityPayload{
					ReqAction: "affinity", Uid: req.Uid, SessionId: req.SessionId, Uuid: req.Uuid,
				},
			},
		})
		if err != nil {
			log.Println(err)
		}
		err = natsClient.Publish("env.internal", msg)
		if err != nil {
			log.Println(err)
		}
	}
}
