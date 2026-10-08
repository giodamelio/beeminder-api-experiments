# Fetch everything needed to inspect or edit a goal's bright red line.
#
#   hurl fetch-goal.hurl | jq .
#
# devenv.nix sets HURL_VARIABLE_user, HURL_VARIABLE_goal and HURL_SECRET_token; override the goal
# with --variable goal=<slug>. Prints two JSON documents to stdout: the goal, then its graph data.
# The token is a personal auth token, so it goes in auth_token, not access_token (that is for OAuth).
# user must be the real username: the vx endpoint 404s on "me".


# Goal as the public API sees it. roadall is the bright red line that PUT accepts back,
# with dates as unix timestamps.
# hurl only prints the last response by default, so this one is sent to stdout explicitly.
GET https://www.beeminder.com/api/v1/users/{{user}}/goals/{{goal}}.json
[Query]
auth_token: {{token}}
[Options]
output: -
HTTP 200
[Asserts]
jsonpath "$.slug" == "{{goal}}"
jsonpath "$.roadall" isCollection


# Undocumented endpoint the official graph editor (graph.beeminder.com) loads goals from.
# It is the input beebrain/bgraph need to compute and render the graph: params.road holds
# the line with daystamps in the goal's timezone, and data holds every datapoint.
GET https://www.beeminder.com/api/vx/users/{{user}}/goals/{{goal}}/graph.json
[Query]
auth_token: {{token}}
HTTP 200
[Asserts]
jsonpath "$.params.road" isCollection
jsonpath "$.data" isCollection
