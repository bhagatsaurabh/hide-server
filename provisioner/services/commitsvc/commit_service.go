package commitsvc

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"hideserver/provisioner/config"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

func CommitK8sImage(uuid string, baseImage string, devEnv string) error {
	_config, err := config.LoadK8sConfig()

	/* clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel() */

	return err
}

// Development-only
func CommitDockerImage(uuid string, baseImage string) error {
	cli, err := config.LoadDockerConfig()

	if err != nil {
		log.Println("Error creating docker client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	tempDir := fmt.Sprintf("./temp_%s", uuid)
	os.MkdirAll(tempDir, os.ModePerm)

	err = copyWorkspaceFromContainer(ctx, cli, uuid, tempDir)
	if err != nil {
		return err
	}

	_, err = generateDockerfile(baseImage, tempDir)
	if err != nil {
		return err
	}

	tarCtx, err := createTarContext(tempDir)
	if err != nil {
		return err
	}

	return buildAndPushImage(ctx, cli, tarCtx, uuid)
}

func copyWorkspaceFromContainer(ctx context.Context, cli *client.Client, containerId string, tempDir string) error {
	reader, _, err := cli.CopyFromContainer(ctx, containerId, "/home/devuser/workspace")
	if err != nil {
		return err
	}
	defer reader.Close()

	return untar(reader, tempDir)
}

func untar(reader io.Reader, target string) error {
	tr := tar.NewReader(reader)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		fpath := filepath.Join(target, hdr.Name)
		if hdr.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}

		os.MkdirAll(filepath.Dir(fpath), os.ModePerm)
		f, err := os.Create(fpath)
		if err != nil {
			return err
		}

		_, err = io.Copy(f, tr)
		f.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func generateDockerfile(baseImage string, tempDir string) (string, error) {
	dockerfile := fmt.Sprintf("FROM %s\nCOPY workspace /home/devuser/workspace\n", baseImage)
	dockerfilePath := filepath.Join(tempDir, "Dockerfile")
	return dockerfilePath, os.WriteFile(dockerfilePath, []byte(dockerfile), 0644)
}

func createTarContext(tempDir string) (io.Reader, error) {
	buf := new(bytes.Buffer)
	tw := tar.NewWriter(buf)

	err := filepath.Walk(tempDir, func(file string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(tempDir, file)
		if err != nil {
			return err
		}

		if fi.IsDir() {
			return nil
		}

		f, err := os.Open(file)
		if err != nil {
			return err
		}
		defer f.Close()

		hdr, err := tar.FileInfoHeader(fi, "")
		if err != nil {
			return err
		}

		hdr.Name = relPath
		tw.WriteHeader(hdr)
		io.Copy(tw, f)
		return nil
	})

	if err != nil {
		return nil, err
	}

	tw.Close()
	return buf, nil
}

func buildAndPushImage(ctx context.Context, cli *client.Client, tarCtx io.Reader, imageName string) error {
	buildResp, err := cli.ImageBuild(ctx, tarCtx, types.ImageBuildOptions{
		Tags:       []string{imageName},
		Dockerfile: "Dockerfile",
		Remove:     true,
	})
	if err != nil {
		return err
	}
	defer buildResp.Body.Close()
	io.Copy(os.Stdout, buildResp.Body)

	// Push
	pushResp, err := cli.ImagePush(ctx, imageName, image.PushOptions{
		RegistryAuth: "<base64-auth>",
	})
	if err != nil {
		return err
	}
	defer pushResp.Close()
	io.Copy(os.Stdout, pushResp)
	return nil
}
