package main

import (
	"context"
	"fmt"
	"hideserver/provisioner/server"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

func main() {
	sysCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	redisHost := os.Getenv("REDIS_HOST")
	redisPort := os.Getenv("REDIS_PORT")
	redisClient := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", redisHost, redisPort),
		DB:   1,
	})

	natsURI := os.Getenv("NATS_URL")
	natsClient, err := nats.Connect(natsURI)
	if err != nil {
		log.Fatalf("Error connecting to NATS: %v", err)
	}
	defer natsClient.Drain()

	port := os.Getenv("SERVICE_PORT")
	if port == "" {
		port = "80"
	}
	srv := server.NewServer(sysCtx, redisClient, natsClient)
	httpSrv := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: srv.Router,
	}

	go func() {
		log.Println("Server is running on port", port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	<-sysCtx.Done()
	log.Println("Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Fatalf("Graceful shutdown failed: %+v", err)
	}
}
