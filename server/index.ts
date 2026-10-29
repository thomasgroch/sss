import { boolean, capsule, endpoint, mutation, query, string, table, text, userId } from "lakebed/server";
import { cleanTodoText } from "../shared/todo";

export default capsule({
  name: "sss",

  auth: { requireSignIn: false },

  schema: {
    todos: table({
      text: string(),
      done: boolean().default(false),
      ownerId: userId()
    }).index("by_owner", ["ownerId"])
  },

  // The `tool` option lets browser agents call a handler through WebMCP.
  queries: {
    todos: query(
      async (ctx) => {
        const { userId } = ctx.auth.requireIdentity();
        return ctx.db.todos
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .order("desc")
          .collect();
      },
      { tool: { description: "List the current user's todos, newest first." } }
    )
  },

  mutations: {
    addTodo: mutation(
      async (ctx, args) => {
        const { userId } = ctx.auth.requireIdentity();
        const cleanText = cleanTodoText(args.text);
        if (!cleanText) {
          return;
        }

        await ctx.db.todos.insert({ text: cleanText, ownerId: userId });
      },
      { tool: { description: "Add a todo for the current user.", args: { text: string() } } }
    )
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok"))
  }
});
