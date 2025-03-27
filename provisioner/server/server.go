package server

import (
	"hideserver/provisioner/handlers/provisionhndl"
	"net/http"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer() *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/provision", provisionhndl.ProvisionHandler)

	return &Server{Router: mux}
}
