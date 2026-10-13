package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"runtime"

	"github.com/spf13/cobra"
	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/output"
	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
)

type infoModule struct{ e *env }

func (infoModule) Groups() []rungrad.Group { return nil }

var (
	versionSpec = rungrad.CommandSpec{
		Path:        "version",
		Summary:     "Show this tool's version and protocol",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud version", "soundroo-cloud version --json"},
		Related:     []string{"soundroo-cloud meta"},
	}
	metaSpec = rungrad.CommandSpec{
		Path:        "meta",
		Summary:     "Show the service's supported engines and limits",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud meta", "soundroo-cloud meta --service http://127.0.0.1:8350 --json"},
		Related:     []string{"soundroo-cloud version"},
	}
)

func (infoModule) Catalog() []rungrad.CommandSpec {
	return []rungrad.CommandSpec{versionSpec, metaSpec}
}

func (m infoModule) Commands() []*rungrad.Command { return []*rungrad.Command{m.version(), m.meta()} }

type versionResult struct {
	Name     string `json:"name"`
	Version  string `json:"version"`
	Protocol int    `json:"protocol"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

func (infoModule) version() *rungrad.Command {
	return &rungrad.Command{
		Use:         "version",
		Short:       versionSpec.Summary,
		Long:        "Show this tool's version, the JSON protocol the Soundroo toolkit expects and the platform it was built for. Nothing is sent to the service.",
		Examples:    versionSpec.Examples,
		Related:     versionSpec.Related,
		OutputModes: versionSpec.OutputModes,
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			result := versionResult{Name: Name, Version: Version, Protocol: Protocol, OS: runtime.GOOS, Arch: runtime.GOARCH}
			return f.WriteResult(result, func(w io.Writer) {
				fmt.Fprintf(w, "%s %s (protocol %d, %s/%s)\n", Name, Version, Protocol, runtime.GOOS, runtime.GOARCH)
			})
		},
	}
}

func (m infoModule) meta() *rungrad.Command {
	return &rungrad.Command{
		Use:         "meta",
		Short:       metaSpec.Summary,
		Long:        "Ask the service which engine releases it renders with and which limits apply. No key is needed.",
		Examples:    metaSpec.Examples,
		Related:     metaSpec.Related,
		OutputModes: metaSpec.OutputModes,
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			c := m.e.client(f, o, "")
			var raw map[string]json.RawMessage
			if _, err := c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/meta", Retry: true, Anonymous: true}, &raw); err != nil {
				return err
			}
			var engines []struct {
				Version       string `json:"version"`
				Hash          string `json:"hash"`
				ScoreVersions []int  `json:"scoreVersions"`
			}
			_ = json.Unmarshal(raw["engines"], &engines)
			var limits map[string]json.Number
			_ = json.Unmarshal(raw["limits"], &limits)
			var latest string
			_ = json.Unmarshal(raw["latestEngine"], &latest)
			type engine struct {
				Version       string `json:"version"`
				Hash          string `json:"hash"`
				ScoreVersions []int  `json:"scoreVersions"`
			}
			result := struct {
				Service      string                 `json:"service"`
				LatestEngine string                 `json:"latestEngine"`
				Engines      []engine               `json:"engines"`
				Limits       map[string]json.Number `json:"limits"`
			}{Service: o, LatestEngine: latest, Engines: []engine{}, Limits: limits}
			for _, e := range engines {
				result.Engines = append(result.Engines, engine(e))
			}
			return f.WriteResult(result, func(w io.Writer) {
				nodes := []output.Node{{Label: "Service", Value: o}, {Label: "Latest engine", Value: latest}}
				for _, e := range result.Engines {
					nodes = append(nodes, output.Node{Label: "Engine " + e.Version, Value: e.Hash})
				}
				output.RenderNodes(w, nodes)
			})
		},
	}
}
