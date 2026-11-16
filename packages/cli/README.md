# opal42

Command-line smoothness score and refiner for CSS gradients. Working package
name; not published yet.

```sh
npx opal42 score src/            # score every linear gradient found
npx opal42 score --json -        # read stdin, machine-readable output
npx opal42 score --fix src/      # rewrite only gradients that refine improves
```

The score is a smoothness score under scoring model v1, not a quality verdict.
Everything runs locally: no network, no telemetry. Node 22 or newer.

Full reference (flags, exit codes, JSON schema, CI recipes): [docs/cli.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/cli.md).
