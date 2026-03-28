<script lang="ts">
  let { label, value }: { label: string; value: string | number } = $props()
</script>

<div class="rounded-lg border border-border bg-card p-4">
  <div class="text-xs text-muted-foreground">{label}</div>
  <div class="text-2xl font-semibold text-card-foreground">{value}</div>
</div>
