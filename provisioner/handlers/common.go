package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"time"
)

type UserHeader struct {
	Uid      string `json:"uid"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Picture  string `json:"picture"`
	Issuer   string `json:"issuer"`
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
