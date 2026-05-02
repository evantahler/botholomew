<script setup>
import DefaultTheme from "vitepress/theme";
import GitHubStars from "./GitHubStars.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-info-after>
      <div class="hero-ctas">
        <GitHubStars />
      </div>
    </template>
  </Layout>
</template>

<style scoped>
.hero-ctas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

@media (max-width: 639px) {
  .hero-ctas {
    justify-content: center;
  }
}
</style>
