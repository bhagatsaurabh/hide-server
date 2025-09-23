package server

import (
	"context"
	"hideserver/provisioner/handlers"
	"net/http"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer(sysCtx context.Context, redisClient *redis.Client, natsClient *nats.Conn) *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/api/provision", func(w http.ResponseWriter, r *http.Request) {
		handlers.ProvisionHandler(sysCtx, w, r, redisClient, natsClient)
	})
	mux.HandleFunc("/api/dispose", func(w http.ResponseWriter, r *http.Request) {
		handlers.DisposeHandler(sysCtx, w, r)
	})
	mux.HandleFunc("/api/delete", func(w http.ResponseWriter, r *http.Request) {
		handlers.DeleteHandler(sysCtx, w, r)
	})
	mux.HandleFunc("/api/commit", func(w http.ResponseWriter, r *http.Request) {
		handlers.CommitHandler(sysCtx, w, r)
	})

	return &Server{Router: mux}
}
