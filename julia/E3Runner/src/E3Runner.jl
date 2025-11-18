"""
E3 Julia Runner

Watches the queue/julia/ directory for tasks and executes them
using the Julia runtime with the East.jl platform.
"""
module E3Runner

using FileWatching

function main()
    e3_repo = get(ENV, "E3_REPO", joinpath(homedir(), ".e3"))
    queue_dir = joinpath(e3_repo, "queue", "julia")

    println("E3 Julia Runner starting...")
    println("Repository: ", e3_repo)
    println("Queue: ", queue_dir)

    # TODO: Implement runner
    # - Watch queue_dir for new task files (using FileWatching)
    # - Atomically claim tasks (rename with worker ID)
    # - Load task commit and check for memoization
    # - Execute tasks with logging using Threads.@spawn
    # - Store results and create completion commits
    # - Handle child task spawning

    println("Watching for tasks...")

    try
        while true
            sleep(1)
        end
    catch e
        if isa(e, InterruptException)
            println("\nShutting down...")
        else
            rethrow(e)
        end
    end
end

end # module
