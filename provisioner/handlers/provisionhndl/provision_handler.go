package provisionhndl

import (
	"encoding/base64"
	"encoding/json"
	"hideserver/provisioner/services/provisionsvc"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
)

type ProvisionDTO struct {
	PrivateKey string                    `json:"privateKey"`
	Message    string                    `json:"message"`
	Workspace  provisionsvc.WorkspaceDTO `json:"workspace"`
}

func ProvisionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var req provisionsvc.ProvisionRequest
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
	var user provisionsvc.UserHeader
	err = json.Unmarshal(decodedBytes, &user)
	if err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid JSON in x-auth-user header")
		return
	}

	var privateKey string
	var workspaceUUID string
	if devEnv, exists := os.LookupEnv("DEV_PLATFORM"); exists && devEnv == "docker" {
		privateKey, workspaceUUID, err = provisionsvc.CreateDockerContainer(req)
	} else {
		privateKey, workspaceUUID, err = provisionsvc.CreateK8sPod(req, devEnv)
	}
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to provision pod")
		return
	}

	var workspace provisionsvc.WorkspaceDTO
	err = provisionsvc.CreateWorkspace(req, userHeader, workspaceUUID, &workspace)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(ProvisionDTO{
		Message:    "Pod created successfully",
		PrivateKey: privateKey,
		Workspace:  workspace,
	})
}
