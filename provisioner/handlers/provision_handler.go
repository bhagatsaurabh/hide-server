package handlers

import (
	"encoding/base64"
	"encoding/json"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
)

type ProvisionDTO struct {
	PrivateKey string                `json:"privateKey"`
	Message    string                `json:"message"`
	Workspace  services.WorkspaceDTO `json:"workspace"`
}

func ProvisionHandler(w http.ResponseWriter, r *http.Request) {
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
				start(w, req.Uuid, devCont.Id, devEnv)
			}
			return
		} else {
			provision(req, w, userHeader, false, devEnv)
		}
	}

	provision(req, w, userHeader, true, devEnv)
}

func provision(req services.ProvisionRequest, w http.ResponseWriter, userHeader string, isNew bool, devEnv string) {
	privateKey, workspaceUUID, err := services.CreateDevContainer(req, isNew, devEnv)
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to provision pod")
		return
	}

	if isNew {
		var workspace services.WorkspaceDTO
		err = services.CreateWorkspace(req, userHeader, workspaceUUID, &workspace)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ProvisionDTO{
			Message:    "Pod created successfully",
			PrivateKey: privateKey,
			Workspace:  workspace,
		})
	} else {
		w.WriteHeader(http.StatusOK)
	}
}
func start(w http.ResponseWriter, uuid string, id string, devEnv string) {
	err := services.StartDevContainer(uuid, id, devEnv)
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to boot workspace")
	}
}
