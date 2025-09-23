package handlers

import (
	"context"
	"encoding/json"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

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

func ProvisionHandler(sysCtx context.Context, w http.ResponseWriter, r *http.Request, redisClient *redis.Client, natsClient *nats.Conn) {
	bgCtx, cancel := context.WithTimeout(sysCtx, 3*time.Minute)

	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		cancel()
		return
	}
	var req services.ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		cancel()
		return
	}
	if req.Uuid == "" {
		services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "1/6:Validating request")
	}
	if req.Image == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing field: image")
		cancel()
		return
	}
	templates, err := services.GetTemplates(redisClient)
	if err != nil {
		log.Printf("Error: %v", err)
		util.SendAPIErr(w, http.StatusInternalServerError, "Unknown error")
		cancel()
		return
	}
	_, exists := templates[strings.TrimSuffix(req.Image, "-dev")]
	if !exists {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid field: image")
		cancel()
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing x-auth-user header")
		cancel()
		return
	}
	if eligible, err := services.CheckEligibility(req, userHeader); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "UNKNOWN")
		cancel()
		return
	} else if !eligible {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_CREATION_QUOTA_REACHED")
		cancel()
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	if req.Uuid != "" {
		err := CheckWorkspaceMembership(userHeader, req.Uuid)
		if err != nil {
			util.SendAPIErr(w, http.StatusForbidden, "Not a member of the workspace")
			cancel()
			return
		}
		var devContExists bool
		if devContExists, err = services.DevContainerExists(bgCtx, req.Uuid, devEnv); err != nil {
			util.SendAPIErr(w, http.StatusBadRequest, "Could not check container existence")
			cancel()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if devContExists {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(WaitResponse{Wait: false})
		} else {
			services.SendStatus(bgCtx, redisClient, req.Uid, req.SessionId, "Restoring your workspace")

			go func() {
				defer cancel()
				if err := provision(bgCtx, req, userHeader, false, devEnv, redisClient, natsClient); err != nil {
					log.Printf("Provisioning failed: %v", err)
				}
			}()
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(WaitResponse{Wait: true})
		}
		cancel()
		return
	}

	go func() {
		defer cancel()
		if err := provision(bgCtx, req, userHeader, true, devEnv, redisClient, natsClient); err != nil {
			log.Printf("Provisioning failed: %v", err)
		}
	}()
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(WaitResponse{Wait: true})
}

func provision(bgCtx context.Context, req services.ProvisionRequest, userHeader string, isNew bool, devEnv string, redisClient *redis.Client, natsClient *nats.Conn) error {
	privateKey, workspaceUUID, err := services.CreateDevContainer(bgCtx, req, isNew, devEnv, redisClient)
	if err != nil {
		message := "Failed to provision workspace"
		if !isNew {
			message = "Failed to restore workspace"
		}
		msg, cErr := json.Marshal(services.ServiceEvent[services.StatusPayload]{
			Payload: services.ServiceEventPayload[services.StatusPayload]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.StatusPayload]{
					Action: "error", Payload: services.StatusPayload{Message: message},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
		return err
	}

	if isNew {
		var workspace services.WorkspaceDTO
		err = services.CreateWorkspace(req, userHeader, workspaceUUID, &workspace)

		msg, cErr := json.Marshal(services.ServiceEvent[services.ProvisionDTO]{
			Payload: services.ServiceEventPayload[services.ProvisionDTO]{
				Uid: req.Uid, SessionId: req.SessionId, Pattern: "provision", Msg: services.PayloadMessage[services.ProvisionDTO]{
					Action: "success", Payload: services.ProvisionDTO{
						Message:    "Pod created successfully",
						PrivateKey: privateKey,
						Workspace:  workspace,
					},
				}},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		redisClient.Publish(bgCtx, "socket.send", msg)
	} else {
		msg, cErr := json.Marshal(NestWrapper[IntServiceEvent[RequestAffinityPayload]]{
			Pattern: "env.internal",
			Data: IntServiceEvent[RequestAffinityPayload]{
				Payload: RequestAffinityPayload{
					ReqAction: "affinity", Uid: req.Uid, SessionId: req.SessionId, Uuid: req.Uuid,
				},
			},
		})
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
		cErr = natsClient.Publish("env.internal", msg)
		if cErr != nil {
			log.Printf("Warn: %v", cErr)
		}
	}
	return err
}
