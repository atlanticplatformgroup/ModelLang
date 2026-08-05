# ModelLang 0.42 language

ModelLang 0.42 consists of the complete [ModelLang 0.41 language](../0.41/LANGUAGE.md) plus [bounded agent task packets](./AGENT_TASK_PACKETS.md). It adds no source-language grammar and retains canonical IR1.

An authenticated caller may assemble a task packet from exact declared action candidates and caller-selected declared query observations. Assembly evaluates each action through the existing applicability path, executes each observation through the existing query path, and publishes the selected static action contract, current applicability decision, and zero-age resource envelope. Assembly never executes an action.

Version 0.42 advances agent catalog to v4 and MCP adapter manifest to v2, and adds task packet v1 plus target capability `agents.taskPackets`. It advances target capability profile to v6, target `target:postgresql-http-ui-agent-task-packets/6`, and generator profile `postgresql-http-ui-agent-task-packets/26`; resource envelope v1, subject capability view v1, operation manifest v11, capability manifest v10, and canonical IR1 remain unchanged.
