<script setup>
import { onMounted, onUnmounted, ref } from "vue";

const frames = [
  " {o,o}\n /)_)\n  \" \"",
  " {o,o}\n /)_)\n  \" \"",
  " {-,-}\n /)_)\n  \" \"",
  " {o,o}\n /)_)\n  \" \"",
];

const frame = ref(0);
let timer = null;

onMounted(() => {
  timer = setInterval(() => {
    frame.value = (frame.value + 1) % frames.length;
  }, 400);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <pre class="hero-owl" aria-label="Botholomew owl mascot">{{ frames[frame] }}</pre>
</template>
