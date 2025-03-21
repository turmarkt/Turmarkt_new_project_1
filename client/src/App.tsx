import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { useState } from "react";
import { UrlHistory } from "@/components/UrlHistory";

function Router() {
  return (
    <Switch>
      <Route path="/">
        <div className="container mx-auto p-4">
          <div className="flex flex-col gap-4">
            <Home />
            <UrlHistory onSelect={(url) => {
              // Find the Home component and update its URL
              const homeComponent = document.querySelector('input[name="url"]');
              if (homeComponent) {
                const event = new Event('change', { bubbles: true });
                Object.defineProperty(event, 'target', { value: { value: url } });
                homeComponent.dispatchEvent(event);
              }
            }} />
          </div>
        </div>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;