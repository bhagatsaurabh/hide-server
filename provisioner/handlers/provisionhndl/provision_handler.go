package provisionhndl

import (
	"encoding/json"
	"hideserver/provisioner/services/provisionsvc"
	"hideserver/provisioner/util"
	"log"
	"net/http"
)

type ProvisionDTO struct {
	Message string `json:"message"`
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

	if err := provisionsvc.CreateK8sPod(req); err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to provision pod")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)

	json.NewEncoder(w).Encode(ProvisionDTO{
		Message: "Pod created successfully",
	})
}
