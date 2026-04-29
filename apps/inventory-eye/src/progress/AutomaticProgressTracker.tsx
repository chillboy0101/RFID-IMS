import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";

import { apiRequest } from "../api/client";
import { AuthContext } from "../auth/AuthContext";
import { inferProgressWorkflow } from "./workflow";

type Props = {
  currentRouteName: string | null;
  enabled: boolean;
};

type AutoSyncResponse = {
  ok: true;
  action: "continued" | "none" | "started" | "stopped" | "switched";
};

const ROUTE_SYNC_DELAY_MS = 900;
const IDLE_STOP_MS = 5 * 60 * 1000;

export function AutomaticProgressTracker({ currentRouteName, enabled }: Props) {
  const { token, activeTenantId } = useContext(AuthContext);
  const workflow = useMemo(() => inferProgressWorkflow(currentRouteName), [currentRouteName]);

  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const lastSyncKeyRef = useRef<string | null>(null);
  const resumeNeededRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  const clearRouteTimer = useCallback(() => {
    if (!routeTimerRef.current) return;
    clearTimeout(routeTimerRef.current);
    routeTimerRef.current = null;
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (!idleTimerRef.current) return;
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);

  const syncWorkflow = useCallback(
    async (
      nextWorkflow: ReturnType<typeof inferProgressWorkflow>,
      reason: "hidden" | "idle" | "resume" | "route"
    ) => {
      if (!enabled || !token || !activeTenantId || inflightRef.current) return;

      const nextKey = nextWorkflow
        ? `${nextWorkflow.kind}:${nextWorkflow.routeName}:${reason}`
        : `stop:${reason}`;

      if (lastSyncKeyRef.current === nextKey) return;

      inflightRef.current = true;
      try {
        await apiRequest<AutoSyncResponse>("/progress/sessions/auto-sync", {
          method: "POST",
          token,
          body: JSON.stringify(
            nextWorkflow
              ? {
                  kind: nextWorkflow.kind,
                  routeName: nextWorkflow.routeName,
                  routeLabel: nextWorkflow.routeLabel,
                  reason,
                }
              : { kind: null, reason }
          ),
        });
        lastSyncKeyRef.current = nextKey;
        resumeNeededRef.current = !nextWorkflow;
      } catch {
        lastSyncKeyRef.current = null;
      } finally {
        inflightRef.current = false;
      }
    },
    [activeTenantId, enabled, token]
  );

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    if (!enabled || !token || !activeTenantId) return;
    idleTimerRef.current = setTimeout(() => {
      void syncWorkflow(null, "idle");
    }, IDLE_STOP_MS);
  }, [activeTenantId, clearIdleTimer, enabled, syncWorkflow, token]);

  const scheduleWorkflowSync = useCallback(
    (reason: "resume" | "route") => {
      clearRouteTimer();
      if (!enabled || !workflow || !token || !activeTenantId) return;
      routeTimerRef.current = setTimeout(() => {
        void syncWorkflow(workflow, reason);
        armIdleTimer();
      }, reason === "resume" ? 280 : ROUTE_SYNC_DELAY_MS);
    },
    [activeTenantId, armIdleTimer, clearRouteTimer, enabled, syncWorkflow, token, workflow]
  );

  useEffect(() => {
    if (!enabled || !token || !activeTenantId) {
      clearRouteTimer();
      clearIdleTimer();
      lastSyncKeyRef.current = null;
      resumeNeededRef.current = false;
      return;
    }

    scheduleWorkflowSync("route");

    return () => {
      clearRouteTimer();
    };
  }, [activeTenantId, clearIdleTimer, clearRouteTimer, enabled, scheduleWorkflowSync, token, workflow?.kind, workflow?.routeName]);

  useEffect(() => {
    if (!enabled || !token || !activeTenantId) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "active") {
        if (resumeNeededRef.current || lastSyncKeyRef.current === null) {
          scheduleWorkflowSync("resume");
        }
        armIdleTimer();
        return;
      }

      if (previous === "active") {
        clearRouteTimer();
        clearIdleTimer();
        void syncWorkflow(null, "hidden");
      }
    });

    return () => subscription.remove();
  }, [activeTenantId, armIdleTimer, clearIdleTimer, clearRouteTimer, enabled, scheduleWorkflowSync, syncWorkflow, token]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    if (!enabled || !token || !activeTenantId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearRouteTimer();
        clearIdleTimer();
        void syncWorkflow(null, "hidden");
        return;
      }

      if (resumeNeededRef.current || lastSyncKeyRef.current === null) {
        scheduleWorkflowSync("resume");
      }
      armIdleTimer();
    };

    const handleInteraction = () => {
      if (document.visibilityState === "hidden") return;
      armIdleTimer();
      if (resumeNeededRef.current || lastSyncKeyRef.current?.startsWith("stop:")) {
        scheduleWorkflowSync("resume");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("mousemove", handleInteraction, { passive: true });
    window.addEventListener("mousedown", handleInteraction, { passive: true });
    window.addEventListener("keydown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });
    window.addEventListener("scroll", handleInteraction, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("mousemove", handleInteraction);
      window.removeEventListener("mousedown", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      window.removeEventListener("scroll", handleInteraction);
    };
  }, [activeTenantId, armIdleTimer, clearIdleTimer, clearRouteTimer, enabled, scheduleWorkflowSync, syncWorkflow, token]);

  return null;
}
