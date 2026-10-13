// Command soundroo-cloud shares music made with the Soundroo toolkit on a
// Soundroo service. It is built on the rungrad CLI framework.
package main

import (
	"os"

	"github.com/vincentsch/soundroo/cloud-cli/internal/commands"
)

func main() {
	os.Exit(commands.NewApp(commands.Options{}).Run(os.Args[1:], os.Stdout, os.Stderr))
}
